import { expect, test, type Page } from '@playwright/test'

import { gotoRendered, settle } from './helpers'

/**
 * `UX.3` — the reference half of the site, measured rather than eyeballed.
 *
 * WHAT THIS SUITE PROTECTS
 * ------------------------
 * The operating console has had a first-viewport contract since `UX.2A`, asserted
 * by `executive-workspace.spec.ts` and its siblings. The reference routes had
 * none, and it showed: measured on a production build before this increment, six
 * of the eight technical views, the About page, the case study and one store page
 * contained NO framed visual region inside the first viewport at 1440 × 900, and
 * the first one on the status view began 4,021 px down at 390 × 844.
 *
 * A prose reduction with no assertion behind it grows back one paragraph per
 * increment, which is the failure mode `UX-2-REVIEW.md` §D already recorded once.
 * So the contract is here, in the same shape the console's is: every reference
 * route meets the reader with something derived from the repository inside the
 * first screen, at both viewport sizes.
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT
 * ------------------------------------
 * A word count. Prose length is a design pressure, not a contract: a route that
 * has to say something long to be accurate must be free to say it, and a test
 * that forbade that would be a test that rewards vagueness. What is asserted is
 * that the qualifications a reader needs are never the FIRST thing and never
 * behind a control — the second of those is `content-integrity.spec.ts`'s job and
 * is unchanged.
 */

/** Every reference route and route state, in navigation order. */
const REFERENCE_ROUTES: readonly string[] = [
  '/technical',
  '/technical?view=architecture',
  '/technical?view=data-model',
  '/technical?view=kpis',
  '/technical?view=governance',
  '/technical?view=data-sources',
  '/technical?view=status',
  '/technical?view=product-vision',
  '/about',
  '/case-study',
  '/inventory',
  '/dealerships/granite-chevrolet',
  '/dealerships/granite-subaru',
  '/dealerships/granite-pre-owned',
]

/**
 * The offset of the first visual region, and how many are inside the fold.
 *
 * "Visual region" borrows the console's own definition — `[data-visual-region]`,
 * plus the framed figures and tables that the reference routes draw directly —
 * so the two halves of the site are measured by one rule.
 */
async function visualGeometry(
  page: Page
): Promise<{ readonly first: number | null; readonly inFold: number }> {
  await settle(page)
  return page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll(
        'main [data-visual-region], main figure, main table, main img'
      ),
    ].filter((node) => {
      const box = node.getBoundingClientRect()
      return box.width >= 120 && box.height >= 60
    })
    // One chart is one region: a `<figure>` inside a marked module counts once.
    const outermost = nodes.filter(
      (node) => !nodes.some((other) => other !== node && other.contains(node))
    )
    const tops = outermost
      .map((node) => Math.round(node.getBoundingClientRect().top + window.scrollY))
      .sort((a, b) => a - b)
    return {
      first: tops.length === 0 ? null : (tops[0] ?? null),
      inFold: tops.filter((top) => top < window.innerHeight).length,
    }
  })
}

test.describe('every reference route opens on something derived, not on prose', () => {
  for (const route of REFERENCE_ROUTES) {
    test(`${route} shows a visual region in the first viewport at 1440 x 900`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await gotoRendered(page, route)
      const { first, inFold } = await visualGeometry(page)
      expect(first, `${route} draws no visual region at all`).not.toBeNull()
      expect(inFold, `${route}: first visual at ${String(first)} px`).toBeGreaterThan(0)
    })

    test(`${route} puts a visual region within two screens at 390 x 844`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await gotoRendered(page, route)
      const { first } = await visualGeometry(page)
      expect(first, `${route} draws no visual region at all`).not.toBeNull()
      /*
       * Two screens rather than one, and the slack is honest. A phone header
       * carries the breadcrumb, the eyebrow, an `h1` that is a full sentence on
       * most of these routes, and the lede, before anything else can begin —
       * roughly 500 px before the first candidate. One screen would be a contract
       * that could only be met by cutting the heading, and the heading is the
       * fastest thing on the page to read.
       */
      expect(first ?? Number.POSITIVE_INFINITY).toBeLessThan(844 * 2)
    })
  }
})

test.describe('the opening block leads with the answer, not with the caveat', () => {
  for (const route of REFERENCE_ROUTES) {
    test(`${route} draws its visual above its trust line`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await gotoRendered(page, route)
      const offsets = await page.evaluate(() => {
        const first = document.querySelector(
          'main [data-visual-region], main figure, main table, main img'
        )
        // The trust line is the compact provenance sentence every reference route
        // carries under its header. It is a qualification, and a qualification
        // read before the thing it qualifies is a page apologising in advance.
        const trust = [...document.querySelectorAll('main p')].find((node) =>
          /Granite Auto Group is fictional/i.test(node.textContent ?? '')
        )
        const top = (node: Element | undefined | null) =>
          node === undefined || node === null
            ? null
            : Math.round(node.getBoundingClientRect().top + window.scrollY)
        return { visual: top(first), trust: top(trust) }
      })
      expect(offsets.visual, `${route} draws no visual region`).not.toBeNull()
      if (offsets.trust !== null) {
        expect(
          offsets.visual ?? Number.POSITIVE_INFINITY,
          `${route}: visual at ${String(offsets.visual)}, trust line at ${String(offsets.trust)}`
        ).toBeLessThan(offsets.trust)
      }
    })
  }
})
