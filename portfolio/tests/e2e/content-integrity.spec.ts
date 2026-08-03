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
        `${route.path} does not say Granite Auto Group is fictional`
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
      // The home page states it in the trust line and again in the platform
      // story and the proof section. It no longer carries the full paragraph:
      // the hero's bordered caveat panel was one of seven disclosures on the
      // page, which is what made a finished warehouse read as an apology
      // (finding A-04). The paragraph now lives on the two pages whose subject
      // it is, and the test below asserts it is still there.
      expect(text).toMatch(/real-engine validation pending/i)
      expect(text).toMatch(/never been evaluated by an engine|no engine has evaluated/i)
    }
  })

  test('the full explanation still exists, on the pages whose subject it is', async ({
    page,
  }) => {
    if (realEnginePassed) test.skip()
    // Reducing repetition must not reduce what the site actually says. Both of
    // these pages carry the whole argument at full length.
    await gotoRendered(page, '/status')
    expect(await bodyText(page)).toMatch(
      /loads the model, refreshes it against PostgreSQL/i
    )

    await gotoRendered(page, '/kpis')
    expect(await bodyText(page)).toMatch(
      /has never been evaluated by a Microsoft engine/i
    )
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

/**
 * The routes that legitimately render an advertised price.
 *
 * `/` is on the list because its Granite Auto Group section carries the group
 * inventory snapshot. Everything else on the site still renders no currency at
 * all, and the two tests below enforce both halves of that.
 */
const INVENTORY_BEARING = ['/', '/dealerships', '/inventory'] as const

/**
 * Whether a route is one of them.
 *
 * `/` is matched EXACTLY. `startsWith('/')` is true of every route on the site,
 * so a prefix test would exempt the whole suite and the rule would pass while
 * checking nothing.
 */
function isInventoryBearing(path: string): boolean {
  return INVENTORY_BEARING.some((entry) =>
    entry === '/' ? path === '/' : path === entry || path.startsWith(`${entry}/`)
  )
}

test.describe('no KPI value appears anywhere', () => {
  test('the KPI catalogue publishes definitions and says so', async ({ page }) => {
    await gotoRendered(page, '/kpis')
    const text = await bodyText(page)
    expect(text).toMatch(/shows definitions, never values/i)
    expect(text).toMatch(/no invented benchmarks/i)
  })

  /**
   * The currency rule, and why it is narrower than it used to be.
   *
   * It began as "no route renders a currency figure at all", which was correct
   * while the site had no business data on it. The dealership and inventory
   * routes now render ADVERTISED PRICES read from the sanitized reference
   * workbooks, and a blanket ban would have to be either deleted or worked
   * around - and a test that gets worked around stops protecting anything.
   *
   * So the rule is now the thing it was always for. What must never appear is a
   * PERFORMANCE figure: a gross, a revenue, a profit, a return on spend. Those
   * are results, this project has none, and the semantic model has never been
   * evaluated. An advertised price is not one: it is an attribute of a listing
   * that was publicly visible, and every page that shows one says so in the same
   * viewport.
   *
   * The percentage and turn bans are unchanged and still apply everywhere.
   */
  test('no route renders a gross, revenue or profit figure', async ({ page }) => {
    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      const text = await bodyText(page)
      // A currency amount within 60 characters of a performance word.
      const performanceFigure =
        /(?:gross|revenue|profit|margin|return on|spend|cost per)[^.]{0,60}\$\s?\d[\d,]*|\$\s?\d[\d,]*[^.]{0,60}(?:gross|revenue|profit|margin|return on ad)/i
      expect(text, `${route.path} renders a performance currency figure`).not.toMatch(
        performanceFigure
      )
      expect(text, `${route.path} renders a percentage result`).not.toMatch(
        /\b\d{1,3}\.\d\s?%/
      )
      expect(text, `${route.path} renders a turn figure`).not.toMatch(
        /\b\d+\.\d{1,2}\s+turns?\b/i
      )
    }
  })

  test('the routes with no inventory data render no currency figure at all', async ({
    page,
  }) => {
    // The original blanket rule, kept in force everywhere it still belongs. The
    // exemptions are named rather than inferred, so a currency figure appearing
    // on a fourth kind of route fails. The home page is on the list because its
    // Granite Auto Group section carries the group inventory snapshot, median
    // advertised price included.
    for (const route of PRIMARY_ROUTES) {
      if (isInventoryBearing(route.path)) continue
      await gotoRendered(page, route.path)
      const text = await bodyText(page)
      expect(text, `${route.path} renders a currency figure`).not.toMatch(
        /\$\s?\d[\d,]*(?:\.\d{2})?/
      )
    }
  })

  test('every route that does render currency names it as an advertised price', async ({
    page,
  }) => {
    // The compensating rule for the exempted routes. A currency figure is allowed
    // there only because it is an advertised listing price, so each of those
    // routes has to say the words in the same document. A page that started
    // rendering money without that label would be presenting a figure whose
    // provenance the reader cannot see.
    for (const route of PRIMARY_ROUTES) {
      if (!isInventoryBearing(route.path)) continue
      await gotoRendered(page, route.path)
      const text = await bodyText(page)
      if (/\$\s?\d[\d,]*/.test(text)) {
        expect(text, `${route.path} renders currency without naming it`).toMatch(
          /advertised price/i
        )
      }
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
  test('the proof section renders its four figures, and the drawer the rest', async ({
    page,
  }) => {
    // Replaces the same check against the seven-figure credibility strip. The
    // strip is gone - four headline numerals plus a drawer - but the obligation
    // is unchanged and now covers twelve counts rather than seven: every value a
    // visitor can reach must equal the manifest, which is generated from
    // repository evidence.
    await gotoRendered(page, '/')
    const proof = page.locator('#proof')
    await proof.scrollIntoViewIfNeeded()

    const headline = [
      'reportingViews',
      'governedKpis',
      'semanticRelationships',
      'daxMeasures',
    ] as const
    const secondary = [
      'sqlScripts',
      'dataQualityChecks',
      'reconciliations',
      'dimensions',
      'facts',
      'semanticTables',
      'supportingMeasures',
      'staticAssertions',
    ] as const

    // No wait for an animation: these are static text on first paint, which is
    // the property that replaced the count-up.
    let text = (await proof.innerText()).replace(/\s+/g, ' ')
    for (const key of headline) {
      const count = manifest.counts[key]
      expect(text, `${key} label missing`).toContain(count.label)
      expect(text, `${key} value ${String(count.value)} missing`).toMatch(
        new RegExp(`\\b${String(count.value)}\\b`)
      )
    }

    await page.getByRole('button', { name: /see all engineering evidence/i }).click()
    text = (await proof.innerText()).replace(/\s+/g, ' ')
    for (const key of secondary) {
      const count = manifest.counts[key]
      expect(text, `${key} label missing from the drawer`).toContain(count.label)
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

/* -------------------------------------------------------------------------- */
/* The redesign's own content rules                                            */
/* -------------------------------------------------------------------------- */

/**
 * These are the rules the experience redesign introduced, and each one exists
 * because the previous build broke it. They are here rather than in the unit
 * suite because every one of them is a statement about the RENDERED page: how
 * many controls a visitor sees, what reaches the first screen, what a route
 * carries. None of them can be checked from the source.
 *
 * Recorded in portfolio/docs/EXPERIENCE_REDESIGN_V2.md sections 2 and 3.
 */
test.describe('the hero stays a hero', () => {
  test('offers exactly two calls to action, and no more', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, '/')

    // Buttons and button-styled links inside the hero. An earlier build's hero
    // carried two of these plus two status badges, a bordered caveat panel and
    // a three-item legend.
    //
    // Located by `#hero`, NOT by `main > section:first-of-type`. The structural
    // path stopped matching when the floating canvas put two wrapper elements
    // between <main> and the section - and it failed silently in the sibling
    // test below, where a locator resolving to nothing makes "there are no
    // status badges here" pass by finding no elements at all. Both tests now
    // assert the hero exists before asserting anything about its contents.
    const hero = page.locator('#hero')
    await expect(hero).toHaveCount(1)
    await expect(hero.locator('a[class*="min-h-11"]')).toHaveCount(2)
  })

  test('renders no status badge in the hero', async ({ page }) => {
    await gotoRendered(page, '/')
    const hero = page.locator('#hero')
    await expect(hero).toHaveCount(1)
    // `data-status` is what StatusBadge stamps. A hero that opens with two
    // badges is reporting its own risk before it has said what it is.
    await expect(hero.locator('[data-status]')).toHaveCount(0)
  })

  test('puts the headline, the explanation, both actions and the trust line on the first phone screen', async ({
    page,
  }) => {
    // The single worst thing about the previous build: at this viewport a
    // visitor saw a headline, a paragraph and two risk disclosures, with the
    // first call to action roughly 1,050px down. Finding A-01.
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoRendered(page, '/')

    const fold = 844
    for (const [name, locator] of [
      ['the headline', page.getByRole('heading', { level: 1 })],
      ['the primary action', page.getByRole('link', { name: /explore the platform/i })],
      [
        'the secondary action',
        page.getByRole('link', { name: /view engineering evidence/i }).first(),
      ],
    ] as const) {
      const box = await locator.first().boundingBox()
      expect(box, `${name} is not rendered`).not.toBeNull()
      expect(box!.y, `${name} starts below the first screen`).toBeLessThan(fold)
    }
  })

  test('names Michael Palmer’s dealership experience above the fold on a desktop', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, '/')
    const aboveFold = await page.evaluate(() => {
      const texts: string[] = []
      for (const element of document.querySelectorAll('main h1, main p')) {
        const box = element.getBoundingClientRect()
        if (box.top < window.innerHeight && box.bottom > 0) {
          texts.push(element.textContent ?? '')
        }
      }
      return texts.join(' ')
    })
    // The differentiator, not a generic platform claim. In the previous build
    // this first appeared roughly 7,900px down the page.
    expect(aboveFold).toMatch(/run the dealership/i)
    expect(aboveFold).toMatch(/25 years/i)
  })
})

test.describe('the engineering proof shows the strongest four counts', () => {
  test('sets exactly four figures as headline numerals', async ({ page }) => {
    await gotoRendered(page, '/')
    await mainText(page)
    // The previous build showed seven at equal weight, three of which described
    // the size of a fictional dealer group. Finding B-03.
    const numerals = page.locator('#proof .text-numeral')
    await expect(numerals).toHaveCount(4)
  })

  test('shows the four agreed figures and none of the secondary ones by default', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    const proof = page.locator('#proof')
    const numerals = await proof.locator('.text-numeral').allInnerTexts()
    expect(numerals.map((value) => value.trim())).toEqual([
      String(manifest.counts.reportingViews.value),
      String(manifest.counts.governedKpis.value),
      String(manifest.counts.semanticRelationships.value),
      String(manifest.counts.daxMeasures.value),
    ])
    // The rest are behind a disclosure, closed by default and out of the DOM.
    await expect(page.locator('#secondary-counts')).toHaveCount(0)
  })

  test('opens the evidence drawer on activation, and only then', async ({ page }) => {
    await gotoRendered(page, '/')
    const trigger = page.getByRole('button', { name: /see all engineering evidence/i })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    await expect(page.locator('#secondary-counts')).toBeVisible()
    await expect(
      page.getByRole('button', { name: /hide the rest of the evidence/i })
    ).toHaveAttribute('aria-expanded', 'true')
  })
})

test.describe('every route carries exactly one trust line', () => {
  test('states the synthetic data, the fictional group and the validation state', async ({
    page,
  }) => {
    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      const main = await mainText(page)
      expect(main, `${route.path} does not state the data is synthetic`).toMatch(
        /synthetic/i
      )
      expect(main, `${route.path} does not say the group is fictional`).toMatch(
        /fictional/i
      )
    }
  })

  test('names the real-engine validation state on every route but the one that is the disclosure', async ({
    page,
  }) => {
    if (manifest.semanticModel.realEngineStatus === 'complete') test.skip()
    for (const route of PRIMARY_ROUTES) {
      // `/governance` suppresses the trust line because its whole body IS the
      // disclosure, at full length.
      if (route.path === '/governance') continue
      await gotoRendered(page, route.path)
      const main = await mainText(page)
      expect(main, `${route.path}`).toMatch(/real-engine validation/i)
    }
  })

  test('never states it more than twice in the page body', async ({ page }) => {
    // Once in the header's trust line, and at most once more where a page's own
    // subject requires it. The previous home page said it seven times, which is
    // what made a finished warehouse read as an apology. Finding A-04.
    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      const main = await mainText(page)
      const occurrences = (main.match(/Granite Auto Group is fictional/gi) ?? []).length
      expect(occurrences, `${route.path} repeats the disclosure`).toBeLessThanOrEqual(2)
    }
  })
})

test.describe('public copy carries no em dash', () => {
  /**
   * A house rule, and one worth enforcing mechanically: an em dash in public
   * copy is the single most reliable tell of text that was not read aloud before
   * it was published. The site uses a spaced hyphen or a full stop instead.
   *
   * Scoped to what a visitor reads. Source paths and identifiers are exempt by
   * construction because none of them can contain one.
   */
  test('on every route', async ({ page }) => {
    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      const text = await bodyText(page)
      expect(text.includes('\u2014'), `${route.path} contains an em dash`).toBe(false)
    }
  })

  test('including content that only exists after an interaction', async ({ page }) => {
    /*
     * The first version of this rule passed while an em dash was still being
     * rendered, because `bodyText` only ever sees a route's default state and
     * the offending glyph was inside the data-model explorer's relationship
     * list, which does not exist until an entity is selected.
     *
     * A content rule that only checks what loads by default has a hole in it
     * exactly where the interesting content is. This opens the three
     * interactive surfaces on the site and checks each one.
     */
    // The explorer's entities are SVG groups with `role="option"`, not buttons.
    // The first version of this test looked for a button, timed out, and
    // reported a failure that looked like a detection - which is its own small
    // lesson: a content check that cannot reach the content fails loudly, and
    // that is the correct behaviour, but only if the failure is read properly.
    await gotoRendered(page, '/data-model')
    const entity = page.getByRole('option', { name: /vehicle sale/i }).first()
    await expect(entity, 'no selectable entity found in the explorer').toBeVisible()
    await entity.click()
    await expect(entity).toHaveAttribute('aria-selected', 'true')
    expect(
      (await page.locator('main').innerText()).includes('\u2014'),
      'the data-model explorer renders an em dash once an entity is selected'
    ).toBe(false)

    await gotoRendered(page, '/architecture')
    const node = page.getByRole('option').first()
    if ((await node.count()) > 0) {
      await node.click()
      expect((await page.locator('main').innerText()).includes('\u2014')).toBe(false)
    }

    await gotoRendered(page, '/')
    await page.getByRole('button', { name: /see all engineering evidence/i }).click()
    const tabs = await page
      .getByRole('tablist', { name: /analytical domain/i })
      .getByRole('tab')
      .all()
    for (const tab of tabs) {
      await tab.click()
      expect((await page.locator('main').innerText()).includes('\u2014')).toBe(false)
    }
  })
})

test.describe('the operating view is a product surface, not a dashboard', () => {
  test('offers six domains as real tabs', async ({ page }) => {
    await gotoRendered(page, '/')
    const tablist = page.getByRole('tablist', { name: /analytical domain/i })
    await expect(tablist).toBeVisible()
    await expect(tablist.getByRole('tab')).toHaveCount(6)
    // Exactly one selected, always.
    await expect(tablist.locator('[aria-selected="true"]')).toHaveCount(1)
  })

  test('changes the panel when a domain is chosen, by click and by arrow key', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    const tablist = page.getByRole('tablist', { name: /analytical domain/i })
    const panel = page.getByRole('tabpanel')

    await tablist.getByRole('tab', { name: /inventory/i }).click()
    await expect(panel).toContainText(/financially risky|lot turning/i)

    // Arrow keys move the selection, and focus follows it.
    await page.keyboard.press('ArrowRight')
    await expect(tablist.locator('[aria-selected="true"]')).not.toContainText(
      /^Inventory/
    )
    await expect(tablist.locator('[aria-selected="true"]')).toHaveCount(1)

    await page.keyboard.press('Home')
    await expect(tablist.getByRole('tab', { name: /sales/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  test('shows no value in any domain', async ({ page }) => {
    await gotoRendered(page, '/')
    const tablist = page.getByRole('tablist', { name: /analytical domain/i })
    const tabs = await tablist.getByRole('tab').all()

    for (const tab of tabs) {
      await tab.click()
      const panel = await page.getByRole('tabpanel').innerText()
      // No currency, no percentage, no thousands-separated figure. A KPI
      // identifier such as KPI-GRS-001 is not a value and is allowed.
      expect(panel, 'a currency value appeared').not.toMatch(/[$£€]\s?\d/)
      expect(panel, 'a percentage appeared').not.toMatch(/\b\d+(\.\d+)?\s?%/)
      expect(panel, 'a formatted figure appeared').not.toMatch(/\b\d{1,3},\d{3}\b/)
    }
  })

  test('states that no engine has evaluated the measures it shows', async ({ page }) => {
    await gotoRendered(page, '/')
    const frame = page.locator('#operating-view')
    await expect(frame).toContainText(/no engine has evaluated these measures/i)
  })
})
