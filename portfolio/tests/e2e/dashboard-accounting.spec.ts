/**
 * `/dashboard/accounting`, end to end (`DASH.9-02`).
 *
 * `dashboard-accounting.test.ts` proves the arithmetic and the seeded defects: the signed
 * total, missing sides excluded from it, the four states counted separately, the period
 * resolving to one date. None of that needs a browser.
 *
 * This suite proves what only a browser can:
 *
 *   * the reconciliation is complete HTML with scripting disabled, because a controller
 *     checking whether the books agree should not need a bundle to find out;
 *   * a missing side renders as MISSING in the text a reader actually sees — the single
 *     most consequential rendering decision on this page, and one a view-model test can
 *     only make about a value rather than about a cell;
 *   * the variance direction is stated in words, so the figure does not depend on a minus
 *     glyph or a colour to be understood;
 *   * the page does not read as a general ledger: no journal, trial balance, financial
 *     statement or audit vocabulary appears in the rendered text;
 *   * the exception drill-through resolves to a page that exists.
 */
import { expect, test } from '@playwright/test'

import { affirmativeSentences, gotoRendered, mainText, mainTextContent } from './helpers'

const ROUTE = '/dashboard/accounting'

test.describe('the accounting route renders its governed figures', () => {
  test('answers 200 and names itself in one h1', async ({ page }) => {
    const response = await page.goto(ROUTE)
    expect(response?.status()).toBe(200)

    const headings = page.locator('main h1')
    await expect(headings).toHaveCount(1)
    // The `h1` is the route's NAME now. The claim the sentence used to make —
    // this is a reconciliation against selected control accounts, not a general
    // ledger — is the subtitle immediately under it, which a reader meets before
    // any figure and which `operating-copy.spec.ts` proves is visible.
    await expect(headings.first()).toHaveText('Accounting')
    await expect(page.locator('main')).toContainText(
      'Inventory control reconciliation. Not a general ledger.'
    )
  })

  test('shows both balances, the signed variance and the comparison date', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)

    expect(text).toMatch(/Inventory subledger/i)
    expect(text).toMatch(/GL control balance/i)
    expect(text).toMatch(/Signed variance/i)
    // The date the position was taken. `UX.2C` moved it onto the rail beside the balances it
    // governs, so it cannot scroll away from them.
    expect(text).toMatch(/Position at/i)
    // A real date, not a placeholder.
    expect(text).toMatch(/\d{1,2} \w+ \d{4}/)
  })

  test('states the variance direction in words, not only as a sign', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(
      /(general ledger carries more|subledger carries more|two sides agree exactly)/i
    )
    // And the convention itself is on the page rather than assumed.
    expect(text).toMatch(/GL minus subledger/i)
  })

  test('renders a missing side as missing rather than as a zero balance', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)

    // The development export carries at least one one-sided position at the latest date.
    expect(text).toMatch(/No (GL|subledger) balance/i)
    expect(text).toMatch(/Not comparable/i)
    expect(text).toMatch(/missing GL, \d+ missing subledger/i)
    // A one-sided row shows "Not comparable" in the variance column, never a number.
    expect(text).toMatch(/Not comparable/i)
  })

  test('keeps the four comparison states as separate vocabulary', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/Reconciled/i)
    // The state column names the missing sides rather than folding them into a variance.
    expect(text).toMatch(/Missing (GL|subledger) balance/i)
  })

  test('discloses the planted scenarios and the single-model limitation', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    // textContent, not innerText: the disclosure is server-rendered inside a closed
    // <details>, and the claim worth testing is that it is IN the document rather than
    // visible before a click.
    const text = await mainTextContent(page)
    expect(text).toMatch(/deliberately planted/i)
    expect(text).toMatch(/not agreement between two independent systems/i)
    expect(text).toMatch(/not discovered errors in a real dealership/i)
  })

  test('states which date owns which row', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    /*
     * `UX.2C` moved this from a full region at the foot of the page -- 130 of the route's 422
     * words -- into the disclosure the console uses for detail a reader needs exactly once.
     * `mainTextContent` reads inside a closed `<details>`, which is the point: it is still in
     * the served markup, in reading order, and findable by a browser text search.
     */
    const text = await mainTextContent(page)
    expect(text).toMatch(/which date owns which row/i)
    expect(text).toMatch(/Accounting snapshot date/i)
    expect(text).toMatch(/Balance date/i)
    // The narrowed timing basis, and the reason there is no posting lag.
    expect(text).toMatch(/no posting timestamp/i)
  })

  test('reads as an inventory control reconciliation, not a general ledger', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)

    // AFFIRMATIVE general-ledger vocabulary only. The page states that no journal entry,
    // trial balance or financial statement exists in this project, and those sentences
    // must survive: they are the disclosure, not the defect.
    for (const forbidden of [
      /journal entry/i,
      /journal line/i,
      /trial balance/i,
      /balance sheet/i,
      /profit and loss/i,
      /period close/i,
      /chart of accounts/i,
    ]) {
      expect(
        affirmativeSentences(text, forbidden),
        `general-ledger artefact asserted rather than disclaimed: ${forbidden}`
      ).toEqual([])
    }
  })

  test('claims no audit, certification or external validation', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    for (const forbidden of [
      /books verified/i,
      /accounting certified/i,
      /GL validated/i,
      /audit passed/i,
      /financial controls passed/i,
    ]) {
      expect(text, `unearned claim: ${forbidden}`).not.toMatch(forbidden)
    }
  })
})

test.describe('exception drill-through resolves', () => {
  test('every exception link points at a page that exists', async ({ page }) => {
    await gotoRendered(page, ROUTE)

    const links = page.locator('main a', { hasText: /Open this position/i })
    const count = await links.count()
    expect(count).toBeGreaterThan(0)

    for (let index = 0; index < count; index += 1) {
      const href = await links.nth(index).getAttribute('href')
      expect(href, 'exception drill-through href').toBeTruthy()
      // No warehouse surrogate composite may appear in a URL the console builds.
      expect(href ?? '').not.toMatch(/\d{8}-\d+-\d+/)

      const response = await page.request.get(href ?? '')
      expect(response.status(), `${href} status`).toBe(200)
    }
  })

  test('carries the exception detail as governed text rather than a free note', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/ACC-/)
    expect(text).toMatch(/signed variance|GL balance/i)
  })
})

test.describe('filters narrow both sides together', () => {
  test('a store filter scopes the whole comparison', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-001`)
    const text = await mainText(page)
    expect(text).toContain('GSA-001')
    expect(text).not.toContain('GSA-002')
  })

  test('says the period selects one date rather than a range to total', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    expect(text).toMatch(/never across dates/i)
    expect(text).toMatch(/selects the last comparison date|last comparison date inside/i)
  })
})

test.describe('the page works without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('renders the balances, the states and the exceptions', async ({ page }) => {
    await page.goto(ROUTE)
    // `mainText` scrolls the page to settle reveals, which needs scripting. With
    // JavaScript disabled the document is already complete, so its text is read directly.
    const text = await mainTextContent(page)

    expect(text).toMatch(/Inventory subledger/i)
    expect(text).toMatch(/GL control balance/i)
    expect(text).toMatch(/Signed variance/i)
    expect(text).toMatch(/Reconciled/i)
    expect(text).toMatch(/No (GL|subledger) balance/i)
    await expect(page.locator('main tbody tr').first()).toBeVisible()
  })

  test('keeps the exception drill-through a plain anchor', async ({ page }) => {
    await page.goto(ROUTE)
    const link = page.locator('main a', { hasText: /Open this position/i }).first()
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', /\/dashboard\/accounting\?store=/)
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

  test('keeps the reconciliation table reachable from the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await gotoRendered(page, ROUTE)
    const scrollers = page.locator('main [role="region"][tabindex="0"]')
    expect(await scrollers.count()).toBeGreaterThan(0)
    await expect(scrollers.first()).toHaveAttribute('aria-label', /.+/)
  })
})
