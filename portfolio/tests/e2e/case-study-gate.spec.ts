import { expect, test } from '@playwright/test'

import { bodyText, gotoRendered, mainText } from './helpers'
import { PRIMARY_ROUTES } from './routes'

/**
 * The case-study gate, as rendered.
 *
 * `tests/unit/case-study-gate.test.ts` exercises the five conditions in isolation.
 * This suite asserts the thing that actually matters to a reader: that the locked
 * route says what is missing, and that nowhere on the site does anything imply the
 * analysis has been done.
 *
 * The suite runs with `NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED=false`, set in
 * playwright.config.ts, which is the flag's real configuration. A suite that only
 * ever ran with the flag on would not be testing the gate.
 *
 * Documented in portfolio/docs/CONTENT_MODEL.md section 6.
 */

/**
 * The subject of each of the five blocking reasons.
 *
 * Matched on subject rather than on the manifest's exact wording: the page renders
 * each condition as a reader-facing sentence rather than echoing the generator's
 * string, so `GATE_2_READINESS.md` appears as "a written Gate 2 readiness review".
 * Asserting the subject is what makes this a test of the gate rather than a test of
 * one particular phrasing.
 */
const BLOCKING_SUBJECTS = [
  /build flag/i,
  /readiness review/i,
  /CLOSED/,
  /content and its report screenshots/i,
  /no report page exists to screenshot/i,
]

test.describe('the locked route is an explanation, not an error', () => {
  test('returns 200 rather than a 404 or a redirect', async ({ page }) => {
    // A gated page that 404s teaches a reader that the site is broken. A gated page
    // that explains itself teaches them that the project has boundaries.
    const response = await page.goto('/case-study')
    expect(response?.status()).toBe(200)
    expect(page.url()).toContain('/case-study')
  })

  test('renders a heading that names the state', async ({ page }) => {
    await gotoRendered(page, '/case-study')
    await expect(page.locator('h1')).toContainText('Case study in progress')
  })

  test('states every blocking reason', async ({ page }) => {
    await gotoRendered(page, '/case-study')
    const text = await mainText(page)
    for (const subject of BLOCKING_SUBJECTS) {
      expect(text, `no blocking reason mentions ${String(subject)}`).toMatch(subject)
    }
  })

  test('states that the build flag alone cannot unlock it', async ({ page }) => {
    await gotoRendered(page, '/case-study')
    const text = await mainText(page)
    // The flag being necessary and never sufficient is the substance of the gate.
    // A page that only said "this is behind a flag" would be describing a switch.
    expect(text).toMatch(/necessary|not sufficient|alone|on its own/i)
  })

  test('names the three Gate 2 conditions', async ({ page }) => {
    await gotoRendered(page, '/case-study')
    const text = await mainText(page)
    expect(text).toMatch(/report pages/i)
    expect(text).toMatch(/reconcil/i)
    expect(text).toMatch(/findings/i)
  })

  test('links to the routes that do have content', async ({ page }) => {
    await gotoRendered(page, '/case-study')
    const main = page.locator('main')
    // A dead end is a design failure. The locked page must hand the reader
    // somewhere real.
    const targets = await main
      .locator('a[href^="/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
    expect(targets.length).toBeGreaterThanOrEqual(3)
    expect(targets).not.toContain('/case-study')
  })
})

test.describe('nothing on the locked route resembles a finished case study', () => {
  test('renders no chart, no axis and no figure caption', async ({ page }) => {
    await gotoRendered(page, '/case-study')
    const counts = await page.evaluate(() => ({
      canvas: document.querySelectorAll('main canvas').length,
      images: document.querySelectorAll('main img').length,
      figures: document.querySelectorAll('main figure').length,
    }))
    expect(counts).toEqual({ canvas: 0, images: 0, figures: 0 })
  })

  test('presents no finding, recommendation or business result', async ({ page }) => {
    await gotoRendered(page, '/case-study')
    const text = await mainText(page)

    // No currency figure and no percentage result. A number like "gross improved
    // 12%" on this page would be fabricated, because no analysis has been run.
    expect(text).not.toMatch(/\$\s?\d/)
    expect(text).not.toMatch(
      /\b\d+(\.\d+)?%\s+(increase|decrease|improvement|lift|gain)/i
    )
  })

  test('claims no conclusion in the present perfect', async ({ page }) => {
    await gotoRendered(page, '/case-study')
    const text = await mainText(page)
    for (const claim of [
      /we found that/i,
      /the analysis shows/i,
      /results indicate/i,
      /the data reveals/i,
      /key takeaway/i,
    ]) {
      expect(text, `the page claims a conclusion: ${String(claim)}`).not.toMatch(claim)
    }
  })
})

test.describe('the gate holds across the whole site', () => {
  for (const route of PRIMARY_ROUTES) {
    test(`${route.path} never says the case study is published`, async ({ page }) => {
      await gotoRendered(page, route.path)
      const text = await bodyText(page)
      for (const claim of [
        /case study is (complete|published|available|live)/i,
        /read the (full )?case study/i,
        /view the findings/i,
      ]) {
        expect(text, `${route.path} claims a published case study`).not.toMatch(claim)
      }
    })
  }

  test('Gate 2 is described as closed everywhere it is mentioned', async ({ page }) => {
    for (const path of ['/', '/governance', '/status', '/case-study']) {
      await gotoRendered(page, path)
      const text = await bodyText(page)
      if (!/Gate 2/.test(text)) continue
      expect(text, `${path} implies Gate 2 is open`).not.toMatch(
        /Gate 2 is (open|met|satisfied|passed)/i
      )
    }
  })

  test('the sitemap includes the locked route', async ({ request }) => {
    // The locked page is honest content: it names what is missing and why. There is
    // no reason to hide it from a search index, and hiding it would make the
    // project's boundary invisible to anyone who did not click through.
    const response = await request.get('/sitemap.xml')
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain('/case-study')
  })

  test('robots.txt does not disallow it', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text()
    expect(body).not.toContain('Disallow: /case-study')
  })
})

test.describe('P2.4 and Lifecycle Phase 8 are not claimed as complete', () => {
  /**
   * The portfolio website is delivered. The portfolio PACKAGING increment is not:
   * the rest of it depends on the report layer and on the Gate 2 verdict. This is
   * the boundary most likely to be crossed by accident, because shipping a website
   * feels like finishing something.
   */
  test('the status page reports P2.4 as in progress', async ({ page }) => {
    await gotoRendered(page, '/status')
    const row = page.locator('[data-increment="P2.4"]')
    await expect(row).toBeVisible()
    await expect(row).not.toContainText('Complete')
  })

  test('the status page reports Lifecycle Phase 8 as incomplete', async ({ page }) => {
    await gotoRendered(page, '/status')
    const phase = page.locator('[data-phase="8"]')
    await expect(phase).toBeVisible()
    await expect(phase.locator('[data-status="complete"]')).toHaveCount(0)
  })
})
