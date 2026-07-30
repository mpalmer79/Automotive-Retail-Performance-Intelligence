import { expect, test } from '@playwright/test'

import manifest from '../../src/generated/project-manifest.json'
import kpis from '../../src/content/kpis.json'
import { bodyText, gotoRendered, mainText } from './helpers'
import { PRIMARY_ROUTES } from './routes'

/**
 * Content-integrity tests, in a browser.
 *
 * The unit suite checks that the MANIFEST is honest. This one checks that the
 * RENDERED PAGES are - that the honest statuses actually reach the screen, that
 * the synthetic-data statement is on every route, and that no forbidden claim or
 * value appears anywhere in the visible text.
 *
 * Enforces controls C3, C4 and C5 in
 * docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md.
 */

test.describe('the synthetic-data statement', () => {
  for (const route of PRIMARY_ROUTES) {
    test(`${route.path} states it in the page body, not only in the footer`, async ({
      page,
    }) => {
      await gotoRendered(page, route.path)
      // Scoped to <main>, so a footer-only disclosure fails this test.
      const normalised = await mainText(page)
      expect(normalised, `${route.path} does not say the data is synthetic`).toMatch(
        /synthetic/i
      )
      expect(
        normalised,
        `${route.path} does not say Granite State Auto Group is fictional`
      ).toMatch(/fictional/i)
    })
  }

  test('the home page states it above the fold', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, '/')
    // Everything within the first viewport height.
    const aboveFold = await page.evaluate(() => {
      const texts: string[] = []
      for (const element of document.querySelectorAll('main p, main span')) {
        const box = element.getBoundingClientRect()
        if (box.top < window.innerHeight && box.bottom > 0) {
          texts.push(element.textContent ?? '')
        }
      }
      return texts.join(' ')
    })
    expect(aboveFold).toMatch(/synthetic/i)
  })
})

test.describe('honest status language reaches the screen', () => {
  const realEnginePassed = manifest.semanticModel.realEngineStatus === 'complete'

  test('the home page names the pending real-engine validation', async ({ page }) => {
    await gotoRendered(page, '/')
    const text = await bodyText(page)
    if (!realEnginePassed) {
      expect(text).toMatch(/real-engine validation pending/i)
      expect(text).toMatch(/no Microsoft semantic-model engine has yet loaded it/i)
    }
  })

  test('the Phase 5 card never renders a Complete badge while both engines are pending', async ({
    page,
  }) => {
    if (realEnginePassed) test.skip()
    await gotoRendered(page, '/status')
    // Asserted on the rendered badge, not on the page's prose. The prose
    // legitimately contains the sentence "if this site ever claims that Lifecycle
    // Phase 5 is complete...", and a text search cannot tell an assertion from a
    // statement about one. The badge carries the machine-readable status.
    const phase5 = page.locator('li', {
      has: page.getByText('LIFECYCLE PHASE 5', { exact: true }),
    })
    const badge = phase5.locator('[data-status]').first()
    await expect(badge).toHaveAttribute('data-status', 'in-progress')
    await expect(badge).not.toHaveAttribute('data-status', 'complete')
    await expect(phase5).toContainText(/exit criteria are not met/i)
  })

  test('no status badge on any route reports a pending engine as complete', async ({
    page,
  }) => {
    if (realEnginePassed) test.skip()
    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      // Any badge whose text names the real-engine validation must not be
      // `complete`.
      const badges = await page.$$eval('[data-status]', (nodes) =>
        nodes.map((node) => ({
          status: node.getAttribute('data-status'),
          text: (node.textContent ?? '').toLowerCase(),
        }))
      )
      for (const badge of badges) {
        if (badge.text.includes('real-engine') || badge.text.includes('pending')) {
          expect(badge.status, `${route.path}: "${badge.text}"`).not.toBe('complete')
        }
      }
    }
  })

  test('the status page distinguishes static validation from real-engine validation', async ({
    page,
  }) => {
    await gotoRendered(page, '/status')
    const text = await bodyText(page)
    expect(text).toMatch(/static source validation/i)
    expect(text).toMatch(/real-engine validation/i)
    expect(text).toMatch(/dashboard completion/i)
    expect(text).toMatch(/case-study completion/i)
    // And says explicitly what static validation cannot do.
    expect(text).toMatch(/cannot execute a single line of DAX|proves shape/i)
  })

  test('the status page reports each engine result verbatim', async ({ page }) => {
    await gotoRendered(page, '/status')
    const text = await bodyText(page)
    for (const engine of manifest.engines) {
      expect(text, `${engine.label} result missing`).toContain(
        engine.overallResult.toUpperCase()
      )
      if (engine.validatedAt === null) {
        expect(text).toMatch(/Never\. No engine has run\./i)
      }
    }
  })

  test('the status page reports zero report pages while none exist', async ({ page }) => {
    if (manifest.semanticModel.dashboardPageCount > 0) test.skip()
    await gotoRendered(page, '/status')
    const text = await bodyText(page)
    expect(text).toMatch(/no page, no visual and no bookmark/i)
  })

  test('no route says the project is validated without qualification', async ({
    page,
  }) => {
    if (realEnginePassed) test.skip()
    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      const text = await bodyText(page)
      // "statically validated" and "real-engine validation pending" are fine.
      // A bare "validated" applied to the model is not.
      const bareClaim = /\bthe (?:semantic )?model is validated\b/i
      expect(text, `${route.path}`).not.toMatch(bareClaim)
    }
  })
})

test.describe('no KPI value appears anywhere', () => {
  test('the KPI catalogue publishes definitions and says so', async ({ page }) => {
    await gotoRendered(page, '/kpis')
    const text = await bodyText(page)
    expect(text).toMatch(/shows definitions, never values/i)
    expect(text).toMatch(/no invented benchmarks/i)
  })

  test('no route renders a currency figure or a percentage result', async ({ page }) => {
    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      const text = await bodyText(page)
      // A dealership figure would look like $12,450 or 41.2% or 2.13 turns.
      expect(text, `${route.path} renders a currency figure`).not.toMatch(
        /\$\s?\d[\d,]*(?:\.\d{2})?/
      )
      expect(text, `${route.path} renders a percentage result`).not.toMatch(
        /\b\d{1,3}\.\d\s?%/
      )
      expect(text, `${route.path} renders a turn figure`).not.toMatch(
        /\b\d+\.\d{1,2}\s+turns?\b/i
      )
    }
  })

  test('the case-study route shows no finding, recommendation or fake screenshot', async ({
    page,
  }) => {
    await gotoRendered(page, '/case-study')
    const text = await bodyText(page)
    for (const forbidden of [
      /\bwe (?:found|recommend|conclude)\b/i,
      /\bkey finding/i,
      /\brecommendation\s*[:\d]/i,
      /coming soon/i,
      /\blaunching\b/i,
      /\bQ[1-4]\s*20\d{2}\b/,
    ]) {
      expect(text, `case study matches ${String(forbidden)}`).not.toMatch(forbidden)
    }
    // No image that would be a dashboard screenshot.
    const images = await page.$$eval('main img', (nodes) =>
      nodes.map((node) => node.getAttribute('src') ?? '')
    )
    expect(images.filter((src) => /screenshot|dashboard|report/i.test(src))).toEqual([])
  })
})

test.describe('the case-study gate', () => {
  test('is locked, and says which conditions are unmet', async ({ page }) => {
    if (manifest.caseStudy.unlocked) test.skip()
    await gotoRendered(page, '/case-study')

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Case study in progress'
    )
    const text = await bodyText(page)
    expect(text).toMatch(/Gate 2 CLOSED/i)
    expect(text).toMatch(/Unlock conditions/i)
    // Every condition is stated with its evidence.
    expect(text).toMatch(/Core Power BI report pages are complete/i)
    expect(text).toMatch(/SQL and Power BI totals reconcile/i)
    expect(text).toMatch(/Executive findings are drafted/i)
    // Marked as not met, in words.
    expect(text).toMatch(/Condition not met/i)
  })

  test('explains why the gate exists rather than only that it does', async ({ page }) => {
    await gotoRendered(page, '/case-study')
    const text = await bodyText(page)
    expect(text).toMatch(/A control that never blocks anything was never a control/i)
    expect(text).toMatch(/ADR-0009/)
  })

  test('offers the three routes that do have content', async ({ page }) => {
    await gotoRendered(page, '/case-study')
    for (const name of [/the architecture/i, /KPI catalogue/i, /project status/i]) {
      await expect(page.getByRole('link', { name }).first()).toBeVisible()
    }
  })

  test('states that a build flag alone cannot unlock it', async ({ page }) => {
    await gotoRendered(page, '/case-study')
    const text = await bodyText(page)
    expect(text).toMatch(/build flag alone cannot unlock this page/i)
  })

  test('is reachable from the navigation and is not a 404', async ({ page }) => {
    const response = await page.goto('/case-study')
    expect(response?.status()).toBe(200)
  })
})

test.describe('deferred domains are never labelled implemented', () => {
  test('the KPI catalogue lists the deferred candidates separately', async ({ page }) => {
    await gotoRendered(page, '/kpis')
    await expect(page.getByRole('heading', { name: /^Deferred/ })).toBeVisible()
    const text = await bodyText(page)
    // The four deferred subjects, each named as deferred.
    expect(text).toMatch(/F&I product penetration/i)
    expect(text).toMatch(/Repeat-customer rate/i)
    expect(text).toMatch(/Service-to-sales conversion/i)
    expect(text).toMatch(/Target attainment/i)
    expect(text).toMatch(/outside the current roadmap/i)
  })

  test('no deferred KPI appears among the implemented ones', async ({ page }) => {
    await gotoRendered(page, '/kpis?status=implemented')
    await expect(page.getByRole('heading', { name: /^Implemented/ })).toBeVisible()
    // Scoped by id: `locator('section', { has: heading })` matched an ancestor
    // section that also contained the deferred list.
    const section = await page.locator('#implemented-kpis').innerText()

    // Asserted on the deferred KPIs' NAMES, not on their subject words. An
    // earlier version searched for "F&I" and failed, because the back-end gross
    // KPI legitimately explains that "a store can hold total gross steady while
    // front gross collapses and F&I compensates" - a caution about a real
    // implemented measure, not a claim that F&I penetration exists.
    for (const deferred of kpis.deferred) {
      const name = deferred.name.split(' - ')[0]!.trim()
      expect(
        section,
        `the implemented list names the deferred KPI "${name}"`
      ).not.toContain(name)
    }
  })
})

test.describe('every displayed count matches the manifest', () => {
  test('the credibility strip renders the seven source-backed figures', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    const strip = page.locator('#engineering-counts')
    await strip.scrollIntoViewIfNeeded()
    // Give the counters time to finish incrementing.
    await page.waitForTimeout(1400)
    const text = (await strip.innerText()).replace(/\s+/g, ' ')

    for (const key of [
      'dealerships',
      'dimensions',
      'facts',
      'reportingViews',
      'governedKpis',
      'semanticRelationships',
      'daxMeasures',
    ] as const) {
      const count = manifest.counts[key]
      expect(text, `${key} label missing`).toContain(count.label)
      expect(text, `${key} value ${String(count.value)} missing`).toMatch(
        new RegExp(`\\b${String(count.value)}\\b`)
      )
    }
  })

  test('the KPI catalogue lists exactly the governed KPI set', async ({ page }) => {
    await gotoRendered(page, '/kpis')
    const text = await bodyText(page)
    for (const kpi of kpis.kpis) {
      expect(text, `${kpi.id} is missing from the catalogue`).toContain(kpi.id)
    }
    // And the count in the heading matches.
    await expect(page.getByRole('heading', { name: /^Implemented/ })).toContainText(
      String(kpis.kpis.length)
    )
  })

  test('the data-model page lists every entity with its grain', async ({ page }) => {
    await gotoRendered(page, '/data-model')
    const text = await bodyText(page)
    // Case-insensitive: `innerText` returns rendered text and the label is
    // uppercased by `text-transform`, so the source casing never appears.
    expect((text.match(/declared grain/gi) ?? []).length).toBeGreaterThanOrEqual(13)
  })
})

test.describe('governance content', () => {
  test('leads with the synthetic-data statement rather than burying it', async ({
    page,
  }) => {
    await gotoRendered(page, '/governance')
    const heading = page.getByRole('heading', {
      name: /This project contains no real data, and never will/i,
    })
    await expect(heading).toBeVisible()
    // It is in the first screenful.
    const box = await heading.boundingBox()
    expect(box!.y).toBeLessThan(1400)
  })

  test('states each Gate 2 condition with its evidence', async ({ page }) => {
    await gotoRendered(page, '/governance')
    const text = await bodyText(page)
    expect(text).toMatch(/Gate 2/)
    expect(text).toMatch(/CLOSED/)
    expect(text).toMatch(/PBIR shell/i)
  })

  test('names an enforcement mechanism for every control it claims', async ({ page }) => {
    await gotoRendered(page, '/governance')
    // Every layer of the trust framework, with its controls.
    for (const layer of [
      'The data itself',
      'Definitions',
      'Lineage',
      'Proof',
      'Access',
    ]) {
      await page.getByRole('radio', { name: new RegExp(layer) }).click()
      const panel = page.locator('section[aria-live="polite"]')
      await expect(panel).toContainText(layer)
      // Four controls per layer, each with a source link.
      const links = panel.locator('a[href*="github.com"]')
      expect(await links.count()).toBeGreaterThanOrEqual(4)
    }
  })

  test('names the four permanently prohibited categories', async ({ page }) => {
    await gotoRendered(page, '/governance')
    const text = await bodyText(page)
    expect(text).toMatch(/No real dealership, real store or real dealer group/i)
    expect(text).toMatch(/No real VIN is linked to a synthetic customer/i)
    expect(text).toMatch(/No lender, lending decision or credit data/i)
    expect(text).toMatch(/No manufacturer or dealership logo/i)
  })
})

test.describe('the copy makes claims with referents', () => {
  /**
   * Ten phrases the site may not use. They are banned not for taste but because
   * each one is a claim with nothing behind it - they are what copy says when it
   * has nothing to say, and this site has something to say. Every one of them could
   * be deleted from a sentence without changing its meaning, which is the test.
   *
   * Checked against RENDERED text on every route rather than against the source, so
   * a phrase reaching the screen through a content file or the manifest is caught
   * too.
   */
  const BANNED = [
    'revolutionary',
    'cutting-edge',
    'cutting edge',
    'game-changing',
    'game changing',
    'seamless',
    'next-generation',
    'next generation',
    'unlocking insights',
    'transforming the industry',
    'leveraging data',
    'robust solution',
    'powerful platform',
  ]

  for (const route of PRIMARY_ROUTES) {
    test(`${route.path} uses none of the banned phrases`, async ({ page }) => {
      await gotoRendered(page, route.path)
      const text = (await bodyText(page)).toLowerCase()
      const found = BANNED.filter((phrase) => text.includes(phrase))
      expect(found, `${route.path} contains banned marketing language`).toEqual([])
    })
  }

  test('the social preview card uses none of them either', async ({ request }) => {
    // The one surface a reader sees before the site loads.
    const svg = await (await request.get('/brand/social-preview.svg')).text()
    const lower = svg.toLowerCase()
    expect(BANNED.filter((phrase) => lower.includes(phrase))).toEqual([])
  })

  test('no route claims a completed degree or a certification', async ({ page }) => {
    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      const text = await bodyText(page)
      expect(text, route.path).not.toMatch(/\bcertified\b|\bcertification\b/i)
      expect(text, route.path).not.toMatch(
        /\b(B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?B\.?A\.?|Ph\.?D\.?)\s+in\b/
      )
    }
  })
})

test.describe('the site is not a second analytics application', () => {
  test('makes no network request to anything but its own origin', async ({ page }) => {
    const external: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        external.push(request.url())
      }
    })

    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      await bodyText(page)
    }
    expect(external, 'the site must make no third-party request').toEqual([])
  })

  test('exposes no API route', async ({ request }) => {
    for (const path of ['/api', '/api/kpis', '/api/health', '/api/manifest']) {
      const response = await request.get(path)
      expect(response.status(), `${path} responded`).toBe(404)
    }
  })

  test('renders no chart canvas and no SVG axis', async ({ page }) => {
    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      await expect(page.locator('canvas')).toHaveCount(0)
      // A charting library leaves an axis group behind.
      await expect(
        page.locator('[class*="recharts"], [class*="highcharts"], .apexcharts-canvas')
      ).toHaveCount(0)
    }
  })
})
