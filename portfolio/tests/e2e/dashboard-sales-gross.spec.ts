/**
 * `/dashboard/sales-gross`, end to end (`DASH.3-02`, `DASH.3-03`).
 *
 * `dashboard-sales-gross.test.tsx` proves the arithmetic against the export manifest.
 * This suite proves the other half: that the figures reach the screen, that the
 * bridge's language stays non-causal in the rendered document, that every chart's
 * data survives without JavaScript, and that a filter the route cannot apply says so
 * instead of pretending.
 *
 * Accessibility is covered by the shared axe sweep in `accessibility.spec.ts`, which
 * runs over every route in `routes.ts` and therefore over this one. What is here is
 * what is specific to this page.
 */
import { expect, test } from '@playwright/test'

import { gotoRendered, mainText, mainTextContent } from './helpers'
import { DASHBOARD_VIEWPORTS } from './routes'

const ROUTE = '/dashboard/sales-gross'

test.describe('the route exists and states its context', () => {
  test('answers 200 and renders its heading', async ({ page }) => {
    const response = await page.goto(ROUTE)
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toHaveText(
      /What sold, what it made, and what changed/
    )
  })

  test('names the period, the comparison, the scope and the as-of date', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('December 2025')
    expect(text).toContain('November 2025')
    expect(text).toMatch(/Granite Auto Group, all three stores/i)
    expect(text).toMatch(/31 December 2025/)
  })

  test('marks itself current in the console navigation', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const current = page.locator('[aria-current="page"]')
    await expect(current.filter({ hasText: /Sales and gross/i }).first()).toBeVisible()
  })

  test('carries the dashboard trust line', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    expect(text).toMatch(/Exported SQL figures, not a Power BI result/i)
  })
})

test.describe('the governed figures reach the screen', () => {
  test('renders the nine performance measures with their KPI identifiers', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    for (const label of [
      'Retail units',
      'New units',
      'Used units',
      'Front gross',
      'Back gross',
      'Total gross',
      'Front PVR',
      'Back PVR',
      'Total PVR',
    ]) {
      expect(text, `${label} is missing`).toContain(label)
    }
    for (const kpi of [
      'KPI-SLS-001',
      'KPI-SLS-002',
      'KPI-SLS-003',
      'KPI-GRS-001',
      'KPI-GRS-002',
      'KPI-GRS-003',
      'KPI-GRS-004',
      'KPI-GRS-005',
      'KPI-GRS-006',
    ]) {
      expect(text, `${kpi} is missing`).toContain(kpi)
    }
  })

  test('renders the December figures the export publishes', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    // 92 retail units and $321,935 total gross for December, group scope.
    expect(text).toContain('92')
    expect(text).toContain('$321,935')
  })

  test('carries a methodology disclosure for every governed measure', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const summaries = page.locator('summary', { hasText: 'How is this calculated?' })
    expect(await summaries.count()).toBeGreaterThanOrEqual(9)
  })
})

test.describe('the gross change bridge', () => {
  test('renders its components and its verification state', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    expect(text).toContain('Volume effect')
    expect(text).toContain('Front PVR effect')
    expect(text).toContain('Back PVR effect')
    expect(text).toMatch(/Verified: the exported component numerators sum exactly/i)
  })

  test('uses attribution language and never a causal claim', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    /*
     * Scoped to the BRIDGE SECTION, deliberately. Elsewhere the page legitimately
     * writes "because the export publishes both" about its own data model, and a
     * page-wide scan for the word would flag ordinary explanatory prose. What may
     * never make a causal claim is the decomposition's own copy.
     */
    const text = ((await page.locator('#bridge').textContent()) ?? '').toLowerCase()
    expect(text).toContain('the bridge attributes')
    /*
     * The words a causal claim would need. This is the assertion that would fail if
     * someone rewrote the summary sentence into something more persuasive and less
     * true.
     */
    for (const forbidden of [
      'caused by',
      'was caused',
      'because the',
      'due to the',
      'drove the',
      'responsible for',
    ]) {
      expect(text, `causal language: "${forbidden}"`).not.toContain(forbidden)
    }
  })

  test('withholds itself, with a reason, for a period that is not one whole month', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-07-01..2025-12-31`)
    const text = await mainTextContent(page)
    expect(text).toContain('Bridge not comparable for this period')
    expect(text).toMatch(/single whole month/i)
  })

  test('withholds itself for the first month of the window and says why', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-07`)
    const text = await mainTextContent(page)
    expect(text).toContain('Bridge not comparable for this period')
    expect(text).toMatch(/outside the reporting window/i)
  })
})

test.describe('charts carry their data as text', () => {
  test('puts every trend chart data table in the document', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    /*
     * `textContent`, not `innerText`: the tables are inside a closed `<details>`, and
     * the claim worth testing is that they are IN the document without JavaScript,
     * not that they are visible before a click.
     */
    const text = await mainTextContent(page)
    expect(text).toMatch(/Read retail units as a table/i)
    expect(text).toMatch(/Read total gross as a table/i)
    expect(text).toMatch(/Read what changed against the month before as a table/i)
  })

  test('states a summary sentence for each chart', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const figures = page.locator('main figure')
    expect(await figures.count()).toBeGreaterThanOrEqual(5)
  })

  test('shows the median beside the mean on the distribution', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    expect(text).toMatch(/Median \$/)
    expect(text).toMatch(/Mean \$/)
  })
})

test.describe('filters', () => {
  test('applies the condition filter to units and gross', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const all = await mainText(page)
    await gotoRendered(page, `${ROUTE}?condition=New`)
    const newOnly = await mainText(page)
    expect(newOnly).not.toBe(all)
    expect(newOnly).toContain('Condition')
  })

  test('summarises a filter it cannot apply rather than ignoring it', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?source=LDS-001`)
    const text = await mainTextContent(page)
    expect(text).toMatch(/Lead source/i)
    expect(text).toMatch(/not applied here/i)
  })

  test('reports an unusable parameter and keeps the page intact', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?store=NOPE&compare=sideways&foo=bar`)
    const text = await mainTextContent(page)
    expect(text).toMatch(/was not usable|reset/i)
    // The page still rendered its figures.
    expect(text).toContain('Total gross')
  })

  test('deep links restore the same view', async ({ page }) => {
    const url = `${ROUTE}?store=GSA-001&period=2025-11&condition=Used`
    await gotoRendered(page, url)
    const first = await mainText(page)
    await gotoRendered(page, url)
    expect(await mainText(page)).toBe(first)
  })
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('renders every figure, every chart table and the bridge', async ({ page }) => {
    await page.goto(ROUTE)
    const text = (await page.locator('main').textContent()) ?? ''
    expect(text).toContain('Retail units')
    expect(text).toContain('Total gross')
    expect(text).toContain('Volume effect')
    expect(text).toMatch(/Read total gross as a table/i)
    expect(text).toContain('KPI-GRS-006')
  })

  test('keeps the filter form usable as a native GET submission', async ({ page }) => {
    await page.goto(ROUTE)
    const form = page.locator('form[method="get"]').first()
    await expect(form).toHaveAttribute('action', ROUTE)
  })
})

test.describe('responsive presentation', () => {
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

/* -------------------------------------------------------------------------- */
/* Targets and selling-day pace (DASH.5)                                       */
/* -------------------------------------------------------------------------- */

test.describe('targets and pace on the sales and gross page', () => {
  test('renders the plan beside the totals, with the clock and the projection', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/targets and pace/i)
    expect(text).toMatch(/Target\s+[\d,$]/)
    expect(text).toMatch(/of target/)
    expect(text).toMatch(/selling days/i)
    expect(text).toContain('Selling-day pace projection')
  })

  test('states the plan as a reference rather than drawing it onto the daily trend', async ({
    page,
  }) => {
    /*
     * A monthly plan is a single number for the month. Drawing it as a flat daily line
     * would state a per-day target the reporting layer does not define, and dividing the
     * month by its days to obtain one would be the console inventing a measure. The page
     * says which decision it took.
     */
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/reference beside the totals/i)
    expect(text).toMatch(/flat daily target line/i)
  })

  test('never calls the projection a forecast', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    for (const match of text.matchAll(/\b(forecast\w*|predicted|prediction)\b/gi)) {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0)
      expect(before.toLowerCase()).toMatch(/not a|never a|rather than a|neither a|nor a/)
    }
  })

  test('states the synthetic-target disclosure', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('synthetic internal operating goals')
    expect(text).toContain('not industry benchmarks')
  })

  test('withholds the comparison under a condition filter', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?condition=Used`)
    const text = await mainText(page)
    expect(text).toContain('Target context is not comparable')
  })

  test('withholds the comparison under a sale-type scope', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?scope=used`)
    const text = await mainText(page)
    expect(text).toContain('Target context is not comparable')
  })

  test('keeps the gross-change bridge free of any plan variance', async ({ page }) => {
    /*
     * The bridge decomposes a period-over-period CHANGE into volume, front-rate and
     * back-rate effects. Plan variance answers a different question, and a fourth effect
     * would change what the other three mean.
     */
    await gotoRendered(page, ROUTE)
    const bridge = await page.locator('#bridge').innerText()
    expect(bridge).not.toMatch(/\btarget\b/i)
    expect(bridge).not.toMatch(/plan variance/i)
  })

  test('changes the plan when the store changes', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-001`)
    const first = await mainText(page)
    await gotoRendered(page, `${ROUTE}?store=GSA-003`)
    const second = await mainText(page)
    expect(second).not.toBe(first)
  })

  test('is present without scripting', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(ROUTE)
    const text = await mainTextContent(page)
    expect(text).toContain('Selling-day pace projection')
    expect(text).toContain('synthetic internal operating goals')
    await context.close()
  })
})
