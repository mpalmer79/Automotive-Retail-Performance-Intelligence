/**
 * `/dashboard/deals/[saleId]`, end to end (`DASH.4`).
 *
 * `dashboard-deal-jacket.test.tsx` proves the arithmetic over all 650 deals and drives
 * a corrupted fixture to prove the verification can fail. This suite proves what only
 * a browser can:
 *
 *   * a deal id that names no transaction 404s rather than rendering an empty jacket;
 *   * the whole page is complete HTML with scripting disabled, because a record
 *     somebody prints must not depend on a bundle;
 *   * the PAPER recap carries the transaction and drops the navigation, which is a
 *     `@media print` rule and therefore cannot be tested anywhere but in an engine
 *     that applies it;
 *   * nothing on the page is a control that pretends to act on the deal.
 */
import { expect, test } from '@playwright/test'

import { gotoRendered, mainText, mainTextContent } from './helpers'
import { DASHBOARD_VIEWPORTS, DEAL_JACKET_ROUTE, DEAL_JACKET_SALE_ID } from './routes'

test.describe('the route exists, and only for a deal that exists', () => {
  test('answers 200 and names the transaction in its heading', async ({ page }) => {
    const response = await page.goto(DEAL_JACKET_ROUTE)
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toContainText(DEAL_JACKET_SALE_ID)
  })

  test('404s on a well-formed id that names no transaction', async ({ page }) => {
    const response = await page.goto('/dashboard/deals/SLE-99999999')
    expect(response?.status()).toBe(404)
  })

  test('404s on a malformed id rather than attempting a lookup', async ({ page }) => {
    for (const malformed of ['/dashboard/deals/nonsense', '/dashboard/deals/SLE-1']) {
      const response = await page.goto(malformed)
      expect(response?.status(), `${malformed} did not 404`).toBe(404)
    }
  })

  test('marks the Deal Explorer current, because the jacket is its drill-through', async ({
    page,
  }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const current = page
      .getByRole('navigation', { name: 'Operating' })
      .first()
      .locator('[aria-current="page"]')
    await expect(current).toHaveCount(1)
    await expect(current).toContainText('Deals')
  })

  test('asks search engines not to index one of 650 near-identical documents', async ({
    page,
  }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/
    )
  })
})

test.describe('the page says what it is before it says anything else', () => {
  test('carries the synthetic-data disclosure in the body, above the deal', async ({
    page,
  }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const disclosure = page.locator('#disclosure')
    await expect(disclosure).toContainText(/Fictional transaction/i)
    await expect(disclosure).toContainText(/Not a real sale, customer, or dealership/i)

    // Above the fold means above the money, not merely present somewhere.
    const disclosureTop = await disclosure.evaluate(
      (node) => node.getBoundingClientRect().top
    )
    const frontGrossTop = await page
      .locator('#front-gross')
      .evaluate((node) => node.getBoundingClientRect().top)
    expect(disclosureTop).toBeLessThan(frontGrossTop)
  })
})

test.describe('the money is shown in the formula order, and recomputed', () => {
  test('renders every front-gross component and its result', async ({ page }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const block = page.locator('#front-gross')
    for (const term of [
      'Sale price',
      'Acquisition cost',
      'Reconditioning cost',
      'Pack amount',
      'Front-end gross',
    ]) {
      await expect(block, `${term} missing from the front-gross block`).toContainText(
        term
      )
    }
  })

  test('states the verification result in words rather than in colour', async ({
    page,
  }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    await expect(page.locator('#front-gross')).toContainText(/Verified to the cent/i)
    await expect(page.locator('#total-gross')).toContainText(/Verified to the cent/i)
  })

  test('shows the trade beside the formula and says it is not inside it', async ({
    page,
  }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const trade = page.locator('#trade')
    await expect(trade).toContainText(/Trade variance/i)
    await expect(trade).toContainText(/not.{0,3}part of the front-gross formula/i)
  })

  test('itemizes the back-end gross and reconciles it to the cent', async ({ page }) => {
    /*
     * Through `DASH.4` this test asserted the opposite: that the finance section reported
     * an AGGREGATE back-end gross and implied no product figure, because no product fact
     * had a surface here. `DASH.7` builds the surface, so the assertion is re-aimed. The
     * claim under test is unchanged -- the page shows only what the model actually holds
     * -- but "no product detail exists" would now be a false statement about the data.
     */
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const backGross = page.locator('#back-gross')
    await expect(backGross).toContainText(/Finance reserve/i)
    await expect(backGross).toContainText(/Original product gross/i)
    await expect(backGross).toContainText(/Back-end gross/i)
    await expect(backGross).toContainText(/Reconciled to the cent/i)
  })

  test('names each product contract with its category, provider and coverage', async ({
    page,
  }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const products = page.locator('#products')
    const text = ((await products.textContent()) ?? '').replace(/\s+/g, ' ')
    // Either the deal carries contracts and they are itemized, or it carries none and the
    // page says so as an outcome. A blank section is the one thing that is not acceptable.
    if (/No F&I product was written/i.test(text)) {
      expect(text).toMatch(/real and common outcome/i)
      return
    }
    expect(text).toMatch(/Original gross/i)
    expect(text).toMatch(/Net gross/i)
    expect(text).toMatch(/month coverage/i)
    expect(text).toMatch(/Active|Adjusted|Cancelled/)
  })

  test('names no rate, term, payment or lender anywhere', async ({ page }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const text = await mainTextContent(page)
    // Each of these words appears on the page only inside a "not modelled" statement,
    // so the assertion is that no FIGURE is attached to one.
    expect(text).not.toMatch(/\bAPR\b[^.]{0,20}\d/)
    expect(text).not.toMatch(/\$[\d,]+(\.\d\d)?\s*(?:per month|\/mo\b|monthly)/i)
    /*
     * A month count on this page is a COVERAGE term and never a loan term, so the sweep
     * has to know the difference. `DASH.4` could forbid every "NN months" because no
     * product contract was shown; `DASH.7` shows one per contract, each explicitly
     * captioned "NN-month coverage". Any month count NOT so captioned is what this now
     * forbids, which is the assertion that was always meant.
     */
    const uncaptioned = text.replace(/\b\d{1,3}-month coverage\b/g, ' ')
    expect(uncaptioned).not.toMatch(/\b\d{2,3}\s*months?\b/)
    // "loan term" appears once, inside the limitation that DENIES it. That sentence is
    // the reason the coverage terms above are safe to publish, so the sweep reads what is
    // left after removing it rather than forbidding the disclosure that protects the page.
    expect(text).toMatch(/COVERAGE term and is never a loan term/i)
    expect(
      text.replace(
        /A product contract term is the COVERAGE term and is never a loan term\./g,
        ' '
      )
    ).not.toMatch(/\bloan term\b/i)
  })
})

test.describe('the integrity checklist is real', () => {
  test('lists only checks this increment can perform, and reports them', async ({
    page,
  }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const checks = page.locator('#checks')
    for (const label of [
      'Front-gross identity',
      'Total-gross identity',
      'Back-gross reconciliation',
      'F&I product eligibility',
      'Product adjustment validity',
      'Delivery date validity',
      'Sale-to-inventory relationship',
      'Source lineage',
    ]) {
      await expect(checks, `${label} missing`).toContainText(label)
    }
    // Eight now, and the three `DASH.4` named as absent are real. The section says which
    // they were, so the change is legible on the page rather than only in a changelog.
    await expect(checks).toContainText(/Eight checks/i)
    await expect(checks).toContainText(/they are real now, and each can fail/i)
  })

  test('states where every figure came from', async ({ page }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const text = await mainTextContent(page)
    expect(text).toContain('reporting.vw_deal_jacket')
    expect(text).toMatch(/Dataset version/i)
    expect(text).toMatch(/Contract fingerprint/i)
    expect(text).toMatch(/holdback/i)
  })
})

test.describe('the page is a record, not a workflow', () => {
  test('offers no control that would act on the deal', async ({ page }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const controls = await page
      .locator('main button, main input, main select, main textarea, main form')
      .evaluateAll((nodes) =>
        nodes.map(
          (node) => `${node.tagName.toLowerCase()}:${(node.textContent ?? '').trim()}`
        )
      )
    for (const control of controls) {
      expect(
        /save|submit|approve|assign|edit|update|reprice|desk|fund|contract|send/i.test(
          control
        ),
        `the jacket offers a control that acts on the deal: ${control}`
      ).toBe(false)
    }
  })

  test('makes no causal claim about the deal', async ({ page }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const text = (await mainTextContent(page)).toLowerCase()
    for (const phrase of [
      'caused',
      'responsible for',
      'drove the',
      'thanks to',
      'as a result of',
    ]) {
      expect(text.includes(phrase), `the jacket claims causation: "${phrase}"`).toBe(
        false
      )
    }
  })

  test('names a person nowhere, and identifies staff by synthetic code', async ({
    page,
  }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    const staff = page.locator('#staff')
    await expect(staff).toContainText(/EMP-\d+/)
    await expect(staff).toContainText(/No name exists anywhere in ARPI/i)

    // No cell anywhere on the page holds a contact-shaped value.
    const text = await mainTextContent(page)
    expect(text, 'an email-shaped value reached the jacket').not.toMatch(
      /[\w.]+@[\w.]+\.[a-z]{2,}/i
    )
    expect(text, 'a phone-shaped value reached the jacket').not.toMatch(
      /\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/
    )
    expect(text, 'a street address reached the jacket').not.toMatch(
      /\d+\s+\w+\s+(street|st|road|rd|avenue|ave|drive|dr|lane|ln)\b/i
    )
  })
})

test.describe('the paper recap', () => {
  /*
   * `DEAL_JACKET_SPEC.md` section 17. These assertions run under `media: 'print'`,
   * which is the only place the `@media print` block in `globals.css` applies — a
   * jsdom test would report the screen presentation and call it paper.
   */
  test('keeps the transaction and drops the navigation', async ({ page }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    await page.emulateMedia({ media: 'print' })

    for (const section of [
      '#disclosure',
      '#identity',
      '#vehicle',
      '#front-gross',
      '#trade',
      '#finance',
      '#total-gross',
      '#checks',
    ]) {
      await expect(
        page.locator(section),
        `${section} is missing from print`
      ).toBeVisible()
    }

    await expect(page.locator('header')).toBeHidden()
    await expect(page.locator('footer')).toBeHidden()
    await expect(page.locator('nav[aria-label="Dashboard"]')).toBeHidden()
    await expect(
      page.getByRole('link', { name: /Return to the Deal Explorer/i })
    ).toBeHidden()
  })

  test('opens the lineage disclosure, because paper cannot be clicked', async ({
    page,
  }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    await page.emulateMedia({ media: 'print' })
    const contentVisibility = await page
      .locator('#checks details')
      .first()
      .evaluate((node) =>
        getComputedStyle(node, '::details-content').getPropertyValue('content-visibility')
      )
    expect(contentVisibility).toBe('visible')
  })

  test('keeps a calculation block from breaking across a page', async ({ page }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    await page.emulateMedia({ media: 'print' })
    const breakInside = await page
      .locator('[data-arpi-print="calculation"]')
      .first()
      .evaluate((node) => getComputedStyle(node).breakInside)
    expect(breakInside).toBe('avoid')
  })
})

test.describe('responsive presentation', () => {
  test('keeps the money in formula order at every width', async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await gotoRendered(page, DEAL_JACKET_ROUTE)
      const tops = await page.evaluate(() =>
        ['#front-gross', '#trade', '#finance', '#total-gross'].map(
          (id) => document.querySelector(id)?.getBoundingClientRect().top ?? 0
        )
      )
      const sorted = [...tops].sort((a, b) => a - b)
      expect(tops, `the money is out of order at ${String(width)}px`).toEqual(sorted)
    }
  })

  for (const viewport of DASHBOARD_VIEWPORTS) {
    test(`does not scroll horizontally at ${String(viewport.width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await gotoRendered(page, DEAL_JACKET_ROUTE)
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

  test('renders the whole record, including the arithmetic and the checks', async ({
    page,
  }) => {
    await page.goto(DEAL_JACKET_ROUTE)
    const text = (await page.locator('main').textContent()) ?? ''
    expect(text).toContain(DEAL_JACKET_SALE_ID)
    expect(text).toContain('Front-end gross')
    expect(text).toContain('Total gross')
    expect(text).toMatch(/Verified to the cent/i)
    expect(text).toContain('reporting.vw_deal_jacket')
  })

  test('leaves the way back working as a plain link', async ({ page }) => {
    await page.goto(DEAL_JACKET_ROUTE)
    const back = page.getByRole('link', { name: /Return to the Deal Explorer/i })
    await expect(back).toHaveAttribute('href', '/dashboard/deals')
  })
})

test.describe('navigating back out', () => {
  test('returns to the Deal Explorer', async ({ page }) => {
    await gotoRendered(page, DEAL_JACKET_ROUTE)
    await page.getByRole('link', { name: /Return to the Deal Explorer/i }).click()
    await page.waitForURL('**/dashboard/deals')
    const text = await mainText(page)
    expect(text).toMatch(/Showing 1 to 25 of \d+ deals/)
  })
})
