/**
 * `/dashboard/leads-marketing`, end to end (`DASH.10-01`).
 *
 * `dashboard-leads-marketing.test.ts` proves the arithmetic: the median recomputed from the
 * exported population rather than blended from published ones, KPI-FUN-003 divided by
 * contacted leads, ratio-of-sums against mean-of-ratios, the organic cost rule, the
 * stage partition. None of that needs a browser.
 *
 * This suite proves what only a browser can:
 *
 *   * the whole page is complete HTML with scripting disabled — every figure, every table,
 *     every chart's textual equivalent — because a BDC director looking at response times on
 *     a showroom tablet is exactly the reader a bundle-dependent page fails;
 *   * the cautions a figure cannot be read safely without are BESIDE that figure in the
 *     rendered document, not merely somewhere in it: cancellation rate with show rate,
 *     unanswered leads with the response distribution;
 *   * the bar geometry actually differs between two stores, which is the difference between
 *     a data-driven chart and a hardcoded one — a unit test on the view model cannot tell
 *     them apart;
 *   * no benchmark, recommendation or profit language reaches the reader. That is the
 *     negative that matters most here, and only rendered text can carry it;
 *   * the filters are real URLs, correct under reload and Back;
 *   * the page reflows rather than overflows at 320 px.
 */
import { expect, test, type Page } from '@playwright/test'

import { affirmativeSentences, gotoRendered, mainText, mainTextContent } from './helpers'

const ROUTE = '/dashboard/leads-marketing'

/**
 * A figure, addressed by its heading rather than by its text.
 *
 * `locator('figure', { hasText: 'Appointment outcomes' }).first()` matched the COHORT
 * FUNNEL, whose caption reads "shown under Appointment outcomes" — so three assertions
 * about the appointment block were quietly being made against a different one. Matching on
 * the heading is unambiguous and says what it means.
 */
function figureNamed(page: Page, heading: string) {
  return page
    .locator('figure')
    .filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
}

test.describe('the leads and marketing route renders its governed figures', () => {
  test('answers 200 and names itself in one h1', async ({ page }) => {
    const response = await page.goto(ROUTE)
    expect(response?.status()).toBe(200)
    await expect(page.locator('main h1')).toHaveCount(1)
  })

  test('renders every block a BDC director opens the page for', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    for (const block of [
      'Lead-created cohort',
      'Time to first response',
      'Appointment outcomes',
      'Where the cohort stopped',
      'Sources by outcome',
      'Marketing efficiency',
      'Vendor counts against the CRM',
    ]) {
      expect(text, `${block} is missing from the rendered page`).toContain(block)
    }
  })

  test('states the governed KPI behind each headline measure', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    for (const kpi of [
      'KPI-FUN-001',
      'KPI-FUN-002',
      'KPI-FUN-003',
      'KPI-FUN-004',
      'KPI-FUN-005',
      'KPI-FUN-006',
      'KPI-FUN-007',
      'KPI-FUN-008',
      'KPI-MKT-001',
      'KPI-MKT-002',
      'KPI-MKT-003',
    ]) {
      expect(text, `${kpi} is not attributed anywhere on the page`).toContain(kpi)
    }
  })
})

test.describe('the cautions travel with the figures they qualify', () => {
  test('shows the cancellation rate on the same block as the show rate', async ({
    page,
  }) => {
    /*
     * The exclusion that makes show rate correct is the one a store can game by recording
     * no-shows as advance cancellations. A cancellation rate in a methodology drawer three
     * screens away does not qualify a show rate anybody actually reads.
     */
    await gotoRendered(page, ROUTE)
    const block = figureNamed(page, 'Appointment outcomes')
    await expect(block).toContainText('Show rate')
    await expect(block).toContainText('Cancelled in advance')
    await expect(block).toContainText('excluded from the show-rate denominator')
  })

  test('shows the unanswered leads on the same block as the response distribution', async ({
    page,
  }) => {
    // Both response KPIs are blind to leads nobody answered, so a store that ignores half
    // its leads can report an excellent median. The count is the number that decides
    // whether the median means anything.
    await gotoRendered(page, ROUTE)
    const block = figureNamed(page, 'Time to first response')
    await expect(block).toContainText('Median response')
    await expect(block).toContainText('Leads with no recorded response')
    await expect(block).toContainText('never answered')
  })

  test('says the median is the headline and the mean its companion', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const block = figureNamed(page, 'Time to first response')
    await expect(block).toContainText('KPI-FUN-008')
    await expect(block).toContainText('KPI-FUN-007')
    await expect(block).toContainText('companion to the median')
  })

  test('distinguishes a never-answered lead from a zero-second response', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('it is not a response of zero seconds')
  })

  test('names the grain and date basis of the appointment measures', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const block = figureNamed(page, 'Appointment outcomes')
    await expect(block).toContainText('appointment-grain')
    await expect(block).toContainText('scheduled-date basis')
    await expect(block).toContainText('show-date basis')
  })

  test('states the attribution convention where marketing results are read', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    await expect(page.getByTestId('attribution-notice')).toContainText('first-touch')
  })

  test('qualifies the newest cohort rather than hiding or adjusting it', async ({
    page,
  }) => {
    // The default period is the latest whole month the export carries, which is by
    // definition the least mature cohort on the page.
    await gotoRendered(page, ROUTE)
    await expect(page.getByTestId('cohort-maturity-notice')).toContainText(
      'structurally incomplete'
    )
  })
})

test.describe('the page refuses to say things the data cannot support', () => {
  test('publishes no benchmark, target or quality judgement', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    const offenders = affirmativeSentences(
      text,
      /\b(industry (?:standard|average|benchmark)|target (?:response|CPL|ROAS|cost)|recommended (?:CPL|cost|spend)|best (?:campaign|source)|worst (?:campaign|source)|good response time|healthy (?:contact|show) rate)\b/i
    )
    expect(
      offenders,
      `benchmark language reached the reader: ${offenders.join(' | ')}`
    ).toEqual([])
  })

  test('never calls gross return profit, net profit or return on investment', async ({
    page,
  }) => {
    /*
     * The page DOES contain the words "not profit, not net profit and not return on
     * investment", which is the disclosure doing its job. `affirmativeSentences` drops
     * negated sentences, so this asserts the CLAIM is absent rather than the vocabulary.
     */
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    const offenders = affirmativeSentences(
      text,
      /\b(marketing profit|net profit|return on investment|profit on ad spend)\b/i
    )
    expect(
      offenders,
      `a profit claim reached the reader: ${offenders.join(' | ')}`
    ).toEqual([])
    // And the disclosure that earns the exemption is genuinely present.
    expect(text).toContain('contribution measure')
  })

  test('makes no recommendation and attributes no cause', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    const offenders = affirmativeSentences(
      text,
      /\b(you should|we recommend|increase (?:your )?spend|pause (?:the |this )?campaign|reallocate|optimal budget|call (?:leads )?faster|campaign caused|BDC failed|salesperson lost|bad lead|poor follow-up)\b/i
    )
    expect(offenders, `advice reached the reader: ${offenders.join(' | ')}`).toEqual([])
  })

  test('renders no organic cost as a zero', async ({ page }) => {
    /*
     * A walk-in has no cost per lead. "$0.00" would sort it to the top of any efficiency
     * comparison as the best channel the group operates, which is the single most
     * misleading number this page could publish.
     */
    await gotoRendered(page, ROUTE)
    const organicRows = page.locator('tr', {
      hasText: 'Organic or internal — no advertising cost',
    })
    const count = await organicRows.count()
    expect(
      count,
      'no organic source is in scope, so the rule is untested'
    ).toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      const row = organicRows.nth(index)
      await expect(row).toContainText('Not applicable')
      await expect(row).not.toContainText('$0.00')
    }
  })

  test('renders no infinite or NaN figure anywhere', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).not.toMatch(/\b(Infinity|-Infinity|NaN|undefined|null)\b/)
  })

  test('exposes no lead, customer or communication detail', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    // Lead and customer business codes would be the shape of a leak; the export carries
    // neither, and this asserts none reached the document by another path.
    expect(text).not.toMatch(/\bLED-\d|\bCUS-\d|\bLEAD-\d{4}/)
    expect(text).not.toMatch(/@[a-z0-9-]+\.(com|net|org)/i)
    expect(text).not.toMatch(/\(\d{3}\)\s?\d{3}-\d{4}/)
  })
})

test.describe('the geometry is data', () => {
  test('draws different funnel shapes for two different stores', async ({ page }) => {
    /*
     * The assertion a "the bar exists" test cannot make. A hardcoded bar renders
     * identically for every store; a governed one does not.
     */
    const widthsFor = async (store: string): Promise<string[]> => {
      await gotoRendered(page, `${ROUTE}?store=${store}`)
      return page
        .locator('[data-testid="bar-track"]')
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLElement).dataset.width ?? '')
        )
    }
    const one = await widthsFor('GSA-001')
    const two = await widthsFor('GSA-002')
    expect(one.length).toBeGreaterThan(8)
    expect(one.join(',')).not.toBe(two.join(','))
  })

  test('draws every bar from a governed count rather than filling its track', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const widths = await page
      .locator('[data-testid="bar-track"]')
      .evaluateAll((nodes) =>
        nodes.map((node) =>
          Number(((node as HTMLElement).dataset.width ?? '0%').replace('%', ''))
        )
      )
    expect(widths.length).toBeGreaterThan(8)
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(0)
      expect(width).toBeLessThanOrEqual(100)
    }
    // Not every bar is full: a chart whose every bar fills its track is not showing a
    // distribution, it is showing a decoration.
    expect(widths.filter((width) => width < 99).length).toBeGreaterThan(4)
  })

  test('changes the response distribution when the period changes', async ({ page }) => {
    const shapeFor = async (period: string): Promise<string> => {
      await gotoRendered(page, `${ROUTE}?period=${period}`)
      const block = figureNamed(page, 'Time to first response')
      return (await block.textContent()) ?? ''
    }
    expect(await shapeFor('2025-08')).not.toBe(await shapeFor('2025-12'))
  })
})

test.describe('the filters are URLs', () => {
  test('reproduces the same view on reload and under Back', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const unfiltered = await mainText(page)

    await gotoRendered(page, `${ROUTE}?store=GSA-002&source=LDS-007`)
    const filtered = await mainText(page)
    expect(filtered).not.toBe(unfiltered)

    await page.reload()
    await page.locator('h1').first().waitFor({ state: 'visible' })
    expect(await mainText(page)).toBe(filtered)

    await page.goBack()
    await page.locator('h1').first().waitFor({ state: 'visible' })
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(ROUTE)
  })

  test('scopes the appointment measures with the same filter as the funnel', async ({
    page,
  }) => {
    /*
     * The reason `vw_appointment_source_funnel` exists. Before it, a source filter could
     * only narrow the lead funnel while KPI-FUN-004 stayed group-wide — two populations in
     * one shape. If the appointment block does not move with the filter, that regression is
     * back.
     */
    const outcomesFor = async (query: string): Promise<string> => {
      await gotoRendered(page, `${ROUTE}${query}`)
      const block = figureNamed(page, 'Appointment outcomes')
      return (await block.textContent()) ?? ''
    }
    expect(await outcomesFor('')).not.toBe(await outcomesFor('?source=LDS-007'))
  })

  test('offers a campaign control and applies it', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    await expect(page.locator('#filter-campaign')).toHaveCount(1)

    const before = await mainText(page)
    const value = await page
      .locator('#filter-campaign option')
      .nth(1)
      .getAttribute('value')
    expect(value).toBeTruthy()
    await gotoRendered(page, `${ROUTE}?campaign=${value ?? ''}`)
    expect(await mainText(page)).not.toBe(before)
  })
})

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false })

  test('serves the whole surface as HTML', async ({ page }) => {
    await page.goto(ROUTE)
    // `mainText` settles reveals with an async evaluate, which cannot run here. The text
    // content is the right read anyway: it reaches inside the closed methodology
    // disclosures, and the claim is that the page is COMPLETE without scripting.
    const text = await mainTextContent(page)
    for (const fragment of [
      'Lead-created cohort',
      'Valid leads',
      'Contacted',
      'Appointment set',
      'Median response',
      'Leads with no recorded response',
      'Show rate',
      'Cancelled in advance',
      'Where the cohort stopped',
      'Sources by outcome',
      'Marketing efficiency',
      'Cost per valid lead',
      'Gross return on ad spend',
      'Vendor counts against the CRM',
      'first-touch',
    ]) {
      expect(text, `${fragment} needs JavaScript, which it must not`).toContain(fragment)
    }
  })

  test('draws its bars server-side', async ({ page }) => {
    await page.goto(ROUTE)
    const widths = await page
      .locator('[data-testid="bar-track"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.width ?? '')
      )
    expect(widths.length).toBeGreaterThan(8)
    expect(new Set(widths).size).toBeGreaterThan(1)
  })

  test('keeps the filter form usable as a native GET submission', async ({ page }) => {
    await page.goto(ROUTE)
    const form = page.locator('main form[method="get"]').first()
    await expect(form).toHaveCount(1)
    await form.locator('#filter-source').selectOption('LDS-007')
    await form.getByRole('button', { name: /apply/i }).click()
    await page.locator('h1').first().waitFor({ state: 'visible' })
    expect(page.url()).toContain('source=LDS-007')
  })
})

test.describe('responsive behaviour', () => {
  for (const width of [320, 375, 390, 768, 1024, 1280, 1440, 1920]) {
    test(`does not overflow the page at ${String(width)} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await gotoRendered(page, ROUTE)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(
        overflow,
        `the page scrolls horizontally at ${String(width)} px`
      ).toBeLessThanOrEqual(1)
    })
  }

  test('keeps the wide marketing table inside its own scroll container', async ({
    page,
  }) => {
    // A table this wide cannot reflow into 320 px and must not push the page sideways
    // either. Its own horizontal scroll is the answer, and it has to be reachable.
    await page.setViewportSize({ width: 320, height: 900 })
    await gotoRendered(page, ROUTE)
    const scrollable = await page
      .locator('main div.overflow-x-auto:has(table)')
      .first()
      .evaluate((node) => node.scrollWidth > node.clientWidth)
    expect(scrollable).toBe(true)
  })
})
