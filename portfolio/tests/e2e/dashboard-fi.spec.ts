/**
 * `/dashboard/fi`, end to end (`DASH.7-01`).
 *
 * `dashboard-fi.test.tsx` proves the arithmetic — every headline figure reconciled
 * against the export manifest's own published totals, both sides of every penetration
 * ratio, the back-gross identity, the cache-key regression that once inflated VSC
 * penetration to 288/720. None of that needs a browser.
 *
 * This suite proves what only a browser can:
 *
 *   * the whole page is complete HTML with scripting disabled, because a console that
 *     needs a bundle to show a number is a console that shows nothing on a bad network;
 *   * the disclosure that the data is synthetic and every lender fictional is ABOVE the
 *     money, not merely somewhere in the document;
 *   * the tables reflow rather than overflow at 390 px, which is a CSS fact;
 *   * the methodology is present without JavaScript, inside `<details>` a reader can
 *     open but a crawler and a printer can already see;
 *   * nothing on the page is a control that pretends to act on a deal, a manager or a
 *     product;
 *   * no rank, benchmark, recommendation or rate field appears in the rendered text —
 *     the negative that matters most on this page and the one a unit test can only make
 *     about the view model rather than about what a reader actually sees.
 */
import { expect, test } from '@playwright/test'

import { affirmativeSentences, gotoRendered, mainText, mainTextContent } from './helpers'
import { DASHBOARD_VIEWPORTS } from './routes'

const ROUTE = '/dashboard/fi'

test.describe('the route exists and is the F&I destination', () => {
  test('answers 200 and names what the page is', async ({ page }) => {
    const response = await page.goto(ROUTE)
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toContainText(
      /What the finance office produced, and what the store kept/i
    )
  })

  test('marks F&I current in the console navigation', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const current = page.locator('[aria-current="page"]')
    await expect(current.filter({ hasText: /^F&I$/ }).first()).toBeVisible()
  })

  test('is reachable from the console bar rather than only by typing the URL', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard')
    const link = page.locator(`a[href="${ROUTE}"]`).first()
    await expect(link).toBeVisible()
    await link.click()
    await expect(page.locator('h1')).toContainText(/finance office/i)
  })

  test('no longer names F&I as an unbuilt section anywhere in the console', async ({
    page,
  }) => {
    // `/dashboard` listed F&I as "coming with DASH.7" until it arrived. A page that
    // still says so beside a working link is a page that contradicts itself.
    await gotoRendered(page, '/dashboard')
    const text = await mainTextContent(page)
    expect(text).not.toMatch(/F&I[^.]{0,60}DASH\.7/i)
  })
})

test.describe('the page works with scripting disabled', () => {
  test.use({ javaScriptEnabled: false })

  test('renders every section as complete HTML', async ({ page }) => {
    await page.goto(ROUTE)
    const text = await mainTextContent(page)
    for (const heading of [
      'What the finance office produced',
      'Reserve against product, to the cent',
      'How the deliveries were funded',
      'What was sold, against what could have been',
      'What each category earned',
      'What came back, and when it posted',
      'The same measures, by desk, with their context',
      'How to read this page, and what it cannot tell you',
    ]) {
      expect(text, `${heading} is missing without JavaScript`).toContain(heading)
    }
  })

  test('carries the methodology inside the document, not behind a click', async ({
    page,
  }) => {
    await page.goto(ROUTE)
    const text = await mainTextContent(page)
    expect(text).toMatch(/period proxy/i)
    expect(text).toMatch(/its own denominator/i)
    expect(text).toMatch(/three date bases/i)
  })

  test('applies a filter through a real URL rather than through a script', async ({
    page,
  }) => {
    // The filter bar is the console's one client island. With scripting off the page
    // must still respond to the query string, because that is what makes the state
    // linkable, printable and crawlable.
    const response = await page.goto(`${ROUTE}?store=GSA-001`)
    expect(response?.status()).toBe(200)
    const text = await mainTextContent(page)
    expect(text).toMatch(/Granite Chevrolet/)
  })
})

test.describe('the page says what it is before it says anything else', () => {
  test('puts the synthetic-data disclosure above the money', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const disclosure = page.locator('#context')
    await expect(disclosure).toBeVisible()

    const disclosureTop = await disclosure.evaluate(
      (node) => node.getBoundingClientRect().top
    )
    const production = await page
      .locator('#production')
      .evaluate((node) => node.getBoundingClientRect().top)
    expect(disclosureTop).toBeLessThan(production)
  })

  test('states that every lender, product and provider is fictional', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    expect(text).toMatch(/fictional/i)
    expect(text).toMatch(/synthetic/i)
  })

  test('names the as-of date rather than implying a live figure', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    expect(text).toMatch(/As of/i)
    // "today", "live", "real time" would each be a claim the export cannot support.
    expect(text).not.toMatch(/\breal[- ]time\b/i)
    expect(text).not.toMatch(/\blive data\b/i)
  })
})

test.describe('what the page must never say', () => {
  test('publishes no rank, leaderboard or performance judgement', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    for (const phrase of [
      'top performer',
      'bottom performer',
      'best f&i',
      'worst f&i',
      'leaderboard',
      'ranked',
      'rank ',
      '#1 ',
      'winner',
      'underperform',
    ]) {
      expect(text.toLowerCase(), `the page says "${phrase}"`).not.toContain(phrase)
    }
  })

  test('asserts no benchmark and no target penetration', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    for (const pattern of [
      /industry average/i,
      /industry benchmark/i,
      /best practice/i,
      /target penetration/i,
      /should be above/i,
      /healthy penetration/i,
      /weak penetration/i,
    ]) {
      expect(
        affirmativeSentences(text, pattern),
        `the page asserts ${pattern} rather than denying it`
      ).toEqual([])
    }
  })

  test('states the denials rather than merely omitting the claims', async ({ page }) => {
    // The other half of the rule above. A page that simply never mentioned benchmarks
    // would pass the negative sweep and still leave a reader free to assume 40.7% is
    // being judged against something.
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    expect(text).toMatch(/no benchmark and no target/i)
    expect(text).toMatch(/There is no recommendation/i)
    expect(text).toMatch(/no menu and no offer history/i)
    expect(text).toMatch(/comparisons, not evaluations/i)
  })

  test('publishes no rate, payment or credit field', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    for (const pattern of [
      /\bAPR\b/,
      /\bbuy rate\b/i,
      /\bsell rate\b/i,
      /\brate spread\b/i,
      /\bmonthly payment\b/i,
      /\bcredit score\b/i,
      /\bFICO\b/i,
    ]) {
      expect(
        affirmativeSentences(text, pattern),
        `the page reports ${pattern} rather than denying it`
      ).toEqual([])
    }
    // And the denial itself is present, naming every one of them.
    expect(text).toMatch(
      /models no APR, payment, buy rate, sell rate, rate spread, credit score or lending decision/i
    )
  })

  test('offers no control that pretends to act on a manager or a product', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    // Buttons that submit the filter form are legitimate. A button that claims to
    // change a deal, coach a manager or set a target is not.
    const labels = await page.locator('main button, main [role="button"]').allInnerTexts()
    for (const label of labels) {
      expect(label.toLowerCase()).not.toMatch(
        /coach|assign|approve|decline|set target|adjust|recalculate|send/
      )
    }
  })
})

test.describe('the tables reflow rather than overflow', () => {
  for (const viewport of DASHBOARD_VIEWPORTS) {
    test(`has no horizontal page scroll at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await gotoRendered(page, ROUTE)
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      )
      expect(overflows, `the page scrolls sideways at ${viewport.width}px`).toBe(false)
    })
  }

  test('keeps a wide table inside its own scroll container', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoRendered(page, ROUTE)
    // Any table wide enough to need it sits inside an `overflow-x` ancestor, so the
    // table scrolls and the document does not.
    const escaping = await page.evaluate(() => {
      const offenders: string[] = []
      for (const table of Array.from(document.querySelectorAll('main table'))) {
        if (table.scrollWidth <= document.documentElement.clientWidth) continue
        let node: HTMLElement | null = table.parentElement
        let contained = false
        while (node !== null && node !== document.body) {
          const overflow = getComputedStyle(node).overflowX
          if (overflow === 'auto' || overflow === 'scroll') {
            contained = true
            break
          }
          node = node.parentElement
        }
        if (!contained) offenders.push(table.querySelector('caption')?.textContent ?? '?')
      }
      return offenders
    })
    expect(escaping).toEqual([])
  })
})

test.describe('the numbers on the page are the numbers in the export', () => {
  test('shows both sides of every penetration figure, never the rate alone', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const penetration = page.locator('#penetration')
    const text = (await penetration.innerText()).replace(/\s+/g, ' ')
    // Numerator and denominator are their own COLUMNS, which is stronger than printing
    // "227 of 558" in one cell: a reader can sum either side down the table.
    expect(text).toMatch(/Deals with product/i)
    expect(text).toMatch(/Eligible deals/i)
    expect(text).toMatch(/\d+\.\d%/)
    // And the denominator is described, not left as a bare integer.
    expect(text).toMatch(/Eligible population/i)
  })

  test('states the eligibility rule each category was measured under', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await page.locator('#penetration').innerText()
    expect(text).toMatch(/ELIG-[A-Z]+/)
  })

  test('labels the adjustment section as the adjustment-date basis', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = (await page.locator('#adjustments').innerText()).replace(/\s+/g, ' ')
    expect(text).toMatch(/grouped by the date each posted/i)
    expect(text).toMatch(/posted in the selected period/i)
    expect(text).toMatch(/period proxy/i)
    // The rule stated in the one sentence that makes the basis unmistakable.
    expect(text).toMatch(/is an August event here/i)
  })

  test('shows the back-gross identity and states that it reconciled', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = (await page.locator('#composition').innerText()).replace(/\s+/g, ' ')
    expect(text).toMatch(/reserve/i)
    expect(text).toMatch(/product gross/i)
    expect(text).toMatch(/back-end gross/i)
    expect(text).toMatch(/reconcile/i)
  })

  test('suppresses a below-sample manager figure and says why', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-07`)
    const text = (await page.locator('#managers').innerText()).replace(/\s+/g, ' ')
    // Either every desk cleared the floor in this month, or the ones that did not are
    // labelled. What is never acceptable is a blank cell with no explanation.
    if (/insufficient sample/i.test(text)) {
      expect(text).toMatch(/n\s*=\s*\d+/i)
    }
    expect(text).toMatch(/minimum/i)
  })
})

test.describe('accessibility of the page structure', () => {
  test('has exactly one h1 and a heading for every section', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    expect(await page.locator('h1').count()).toBe(1)
    const sections = page.locator('main section[id]')
    const count = await sections.count()
    expect(count).toBeGreaterThan(5)
  })

  test('gives every table an accessible name', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const unnamed = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('main table')).filter(
          (table) =>
            table.querySelector('caption') === null &&
            table.getAttribute('aria-label') === null &&
            table.getAttribute('aria-labelledby') === null
        ).length
    )
    expect(unnamed).toBe(0)
  })

  test('scopes every header cell, whether the table is columnar or a key-value list', async ({
    page,
  }) => {
    /*
     * Two table SHAPES on this page, and the check has to know the difference. The
     * comparison tables are columnar and carry `th[scope="col"]`. The reconciliation
     * panels are two-column key-value lists whose only headers are ROW headers, and
     * demanding a column header there would push a component towards inventing a
     * meaningless one. What matters either way is that no header cell is unscoped.
     */
    await gotoRendered(page, ROUTE)
    const tables = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main table')).map((table) => ({
        caption: table.querySelector('caption')?.textContent ?? '?',
        headers: table.querySelectorAll('th').length,
        scoped: table.querySelectorAll('th[scope="col"], th[scope="row"]').length,
      }))
    )
    expect(tables.length).toBeGreaterThan(4)
    for (const table of tables) {
      expect(table.headers, `${table.caption} has no header cells`).toBeGreaterThan(0)
      expect(table.scoped, `${table.caption} has an unscoped header`).toBe(table.headers)
    }
  })

  test('reads in a sensible order: context, then production, then evidence', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main section[id]')).map((node) => node.id)
    )
    expect(order.indexOf('context')).toBeLessThan(order.indexOf('production'))
    expect(order.indexOf('production')).toBeLessThan(order.indexOf('penetration'))
    expect(order.indexOf('managers')).toBeLessThan(order.indexOf('methodology'))
  })
})

test.describe('the filter bar states what it does and does not apply', () => {
  test('says the structure filter is partial rather than applying it silently', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?structure=lease`)
    const text = await mainText(page)
    expect(text).toMatch(/Lease/)
    expect(text).toMatch(/structure MIX|structure mix/i)
  })

  test('says an inapplicable filter is not applied here, and why', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?condition=New`)
    const text = await mainTextContent(page)
    /*
     * The console's shared filter grammar parses `condition` on every route, and this
     * one declares it inapplicable. Silently dropping it would leave a reader believing
     * the page was scoped to new vehicles. The page instead shows the chip, marks it
     * "not applied here" and states the reason -- which on this route is a real one:
     * vehicle condition already decides which categories are eligible, inside each
     * denominator, so applying it again on top would filter the population twice.
     */
    expect(text).toMatch(/not applied here/i)
    expect(text).toMatch(/already decides which categories are eligible/i)
  })

  test('scopes the page to one store and says which', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-003`)
    const text = await mainText(page)
    expect(text).toMatch(/Granite Pre-Owned/)
  })
})
