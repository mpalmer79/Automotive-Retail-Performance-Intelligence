import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

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

/**
 * Twice the default timeout, for the whole file, because the site got bigger.
 *
 * Most tests here sweep EVERY route and read its settled text. `settle()` walks a
 * page top to bottom in 60%-viewport steps so that every viewport-triggered reveal
 * has fired, which costs roughly 70ms per step. The console is about twenty
 * thousand pixels tall - the longest document on the site by a wide margin - so
 * adding it as a fourteenth route added about three seconds to every sweep.
 *
 * Two of those sweeps then crossed the 45-second default and failed as TIMEOUTS.
 * A timeout is the least informative way for a content check to fail: it says
 * nothing about the content, and the obvious readings of it are all wrong.
 *
 * The alternative considered and rejected was making `settle()` stop early once no
 * unrevealed element remains. It would be faster, and it would couple this helper
 * to three CSS class names in `reveal.tsx`; if one of those were renamed, `settle`
 * would return early, every content sweep would read an unsettled page, and they
 * would all still pass. A guard whose failure mode is silently weaker assertions is
 * the wrong trade for a few seconds. These tests do more work because there is more
 * site, so they are given more time.
 */
test.beforeEach(({}, testInfo) => {
  testInfo.setTimeout(testInfo.timeout * 2)
})

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

  test('the operating home states it above the fold', async ({ page }) => {
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

  test('the technical overview names the pending real-engine validation', async ({
    page,
  }) => {
    // `UX.1` moved the trust line off the operating routes: the console carries the
    // compact demo statement and puts the validation state inside the methodology
    // disclosure, one click away on every route and asserted there by
    // `operating-copy.spec.ts`. The reference domain still carries the trust line
    // on every route, and this is the one that opens it.
    await gotoRendered(page, '/technical?view=overview')
    const text = await bodyText(page)
    if (!realEnginePassed) {
      // The home page states it in the trust line, which is derived from the
      // manifest and appears on every route. It has never carried the full
      // paragraph: the hero's bordered caveat panel was one of seven disclosures
      // on the page, which is what made a finished warehouse read as an apology
      // (finding A-04).
      //
      // The second assertion here used to be the operating view's chrome line,
      // "no engine has evaluated these measures". That surface is now the first
      // thing on `/kpis`, so the sentence is asserted below on the route that
      // renders it rather than deleted.
      expect(text).toMatch(/real-engine validation pending/i)
    }
  })

  test('the surface that shows the measures says no engine has evaluated them', async ({
    page,
  }) => {
    if (realEnginePassed) test.skip()
    await gotoRendered(page, '/technical?view=kpis')
    const text = await bodyText(page)
    expect(text).toMatch(/never been evaluated by an engine|no engine has evaluated/i)
  })

  test('the full explanation still exists, on the pages whose subject it is', async ({
    page,
  }) => {
    if (realEnginePassed) test.skip()
    // Reducing repetition must not reduce what the site actually says. Both of
    // these pages carry the whole argument at full length.
    await gotoRendered(page, '/technical?view=status')
    expect(await bodyText(page)).toMatch(
      /loads the model, refreshes it against PostgreSQL/i
    )

    await gotoRendered(page, '/technical?view=kpis')
    expect(await bodyText(page)).toMatch(
      /has never been evaluated by a Microsoft engine/i
    )
  })

  test('the Phase 5 card never renders a Complete badge while both engines are pending', async ({
    page,
  }) => {
    if (realEnginePassed) test.skip()
    await gotoRendered(page, '/technical?view=status')
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
    await gotoRendered(page, '/technical?view=status')
    const text = await bodyText(page)
    expect(text).toMatch(/static source validation/i)
    expect(text).toMatch(/real-engine validation/i)
    expect(text).toMatch(/dashboard completion/i)
    expect(text).toMatch(/case-study completion/i)
    // And says explicitly what static validation cannot do.
    expect(text).toMatch(/cannot execute a single line of DAX|proves shape/i)
  })

  test('the status page reports each engine result verbatim', async ({ page }) => {
    await gotoRendered(page, '/technical?view=status')
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
    await gotoRendered(page, '/technical?view=status')
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
 * `/` LEFT THIS LIST AT `UX.1`, and not because it stopped rendering currency: it
 * renders far more of it, because it is the operating console now. That puts it in
 * the OTHER exemption, `KPI_VALUE_EXEMPT` — the operating application publishes
 * governed KPI values from a versioned export under the fifteen conditions
 * ADR-0013 states, and the public-copy rules in this file were written for the
 * reference domain. Leaving it here would have exempted it from the wrong rule for
 * the wrong reason.
 *
 * `/technical` JOINED, for the reason `/` used to be here: its default view is the
 * group context that came off the retired home page, median advertised price
 * included. The three store routes are matched by the `/dealerships` prefix entry.
 * Everything else on the reference half of the site still renders no currency at
 * all, and the two tests below enforce both halves of that.
 */
const INVENTORY_BEARING = ['/inventory', '/dealerships', '/technical'] as const

/**
 * Whether a route is one of them.
 *
 * NO ENTRY MAY BE `/`, and the absence is load-bearing rather than incidental:
 * `startsWith('/')` is true of every route on the site, so a root entry would
 * exempt the whole suite and the rule would pass while checking nothing. `/` is
 * exempted by `KPI_VALUE_EXEMPT` instead, which is an exact-match list.
 *
 * The `?` branch matches a technical VIEW state against its route.
 */
function isInventoryBearing(path: string): boolean {
  return INVENTORY_BEARING.some(
    (entry) =>
      path === entry || path.startsWith(`${entry}/`) || path.startsWith(`${entry}?`)
  )
}

test.describe('no KPI value appears anywhere', () => {
  test('the KPI catalogue publishes definitions and says so', async ({ page }) => {
    await gotoRendered(page, '/technical?view=kpis')
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
  /**
   * THE CONSOLE IS EXEMPT, AND THE EXEMPTION IS AN ADR RATHER THAN A WORKAROUND.
   *
   * ADR-0013 supersedes ADR-0009 §4 in scope "for the `/dashboard` route family
   * only": the console may render KPI values from versioned exports, under fifteen
   * binding conditions, and the documentation routes keep C5 unchanged. So this rule
   * is not weakened - it is scoped to the routes it was written for, and the console
   * gets a stronger rule of its own (`dashboard.spec.ts`): every figure it renders
   * must reconcile to the export, exactly, and `dashboard-executive.test.tsx` proves
   * it selector by selector.
   *
   * Naming the exemption rather than inferring it from a path prefix means a second
   * route that started rendering gross would fail this test until somebody added it
   * here on purpose.
   */
  /*
   * The operating application. It publishes governed KPI values from a versioned
   * export, which is what it is for; these rules are the reference domain's.
   * `/` joined the list at `UX.1`, when it became the console.
   */
  const KPI_VALUE_EXEMPT: readonly string[] = ['/', '/dashboard']

  test('no route renders a gross, revenue or profit figure', async ({ page }) => {
    for (const route of PRIMARY_ROUTES.filter(
      (candidate) => !KPI_VALUE_EXEMPT.includes(candidate.path)
    )) {
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
    // on a fourth kind of route fails.
    for (const route of PRIMARY_ROUTES) {
      if (isInventoryBearing(route.path)) continue
      if (KPI_VALUE_EXEMPT.includes(route.path)) continue
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
    await gotoRendered(page, '/technical?view=kpis')
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
    await gotoRendered(page, '/technical?view=kpis&status=implemented')
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
    // `UX.1` rehomed the engineering proof strip from the marketing home page to
    // the technical overview, which is where the product tour and the store story
    // went with it. The obligation is unchanged: every value a visitor can reach
    // must equal the manifest, which is generated from repository evidence.
    await gotoRendered(page, '/technical?view=overview')
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
    await gotoRendered(page, '/technical?view=kpis')
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
    await gotoRendered(page, '/technical?view=data-model')
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
    await gotoRendered(page, '/technical?view=governance')
    const heading = page.getByRole('heading', {
      name: /This project contains no real data, and never will/i,
    })
    await expect(heading).toBeVisible()
    // It is in the first screenful.
    const box = await heading.boundingBox()
    expect(box!.y).toBeLessThan(1400)
  })

  test('states each Gate 2 condition with its evidence', async ({ page }) => {
    await gotoRendered(page, '/technical?view=governance')
    const text = await bodyText(page)
    expect(text).toMatch(/Gate 2/)
    expect(text).toMatch(/CLOSED/)
    expect(text).toMatch(/PBIR shell/i)
  })

  test('names an enforcement mechanism for every control it claims', async ({ page }) => {
    await gotoRendered(page, '/technical?view=governance')
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
    await gotoRendered(page, '/technical?view=governance')
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

  test('the social card’s alternative text uses none of them either', async ({
    page,
  }) => {
    /*
     * The one surface a reader sees before the site loads.
     *
     * This used to read `/brand/social-preview.svg` and scan the drawn text. The
     * card is now a supplied raster with no extractable text, so the assertion
     * moves to `og:image:alt` — which is not a downgrade in coverage so much as a
     * change of target: the alt text is the only part of this card a platform or
     * a screen reader turns into words, and it is authored in this repository.
     */
    await page.goto('/')
    const alt = await page
      .locator('meta[property="og:image:alt"]')
      .first()
      .getAttribute('content')
    expect(alt, 'og:image:alt is missing').toBeTruthy()
    const lower = (alt ?? '').toLowerCase()
    expect(BANNED.filter((phrase) => lower.includes(phrase))).toEqual([])
  })

  test('no route claims a completed degree or a certification', async ({ page }) => {
    /*
     * The rule is about the author's credentials, and "certified" has a second sense
     * in this domain: a certified pre-owned vehicle. The console's filter grammar
     * carries `condition=Certified` as part of the console-wide vocabulary
     * (`INFORMATION_ARCHITECTURE.md` §6), and the previous version of this test noted
     * that no dashboard route tripped it yet and prescribed the fix when one did:
     * "narrow this pattern to the credential sense, not delete it".
     *
     * One does now. The Executive Overview's accounting row names its GL control
     * accounts, and one of them is `Certified Vehicle Inventory` -- a governed account
     * name from the export, not a claim about a person. So the pattern is narrowed to
     * the credential sense: `certified` immediately preceding or following a
     * credential noun, or `certification` in any form. The vehicle sense is exempted by
     * requiring the word to be about a person or a qualification rather than about a
     * vehicle, an account or an inventory condition.
     */
    const VEHICLE_SENSE = /\bcertified\s+(vehicle|pre-owned|unit|inventory)\b/gi
    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      const text = (await bodyText(page)).replace(VEHICLE_SENSE, 'PRE-OWNED')
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
/* The home page's prose budget                                                */
/* -------------------------------------------------------------------------- */

/**
 * The home page may not exceed 450 words of visible prose, in at most four
 * sections.
 *
 * WHY THIS IS A TEST AND NOT A NOTE IN A DOCUMENT
 * ----------------------------------------------
 * Measured on the prerendered `/` of a production build, this page carried 1,132
 * words of visible paragraph text in 61 paragraphs across 7 sections. A product
 * landing page runs 300 to 500 words. The page had four working experiences
 * linked from it and it read as an essay with the software buried inside.
 *
 * Every one of those words was true and almost none of them were deleted: the
 * operating view is on `/kpis`, the author narrative is on `/about`, the two
 * inventory disclaimers are on `/governance`, and the engineering note about
 * build-time data is on `/architecture`. That is the rule this budget encodes -
 * reference material and disclosure live on the route whose subject they are -
 * and it is the rule a page drifts away from one honest paragraph at a time.
 *
 * A budget in a document is a suggestion. This is the same distinction that
 * makes the colour palette on this site trustworthy and made the word count not:
 * `tests/unit/tokens.test.ts` fails on a colour nobody measured, and nothing
 * failed on a page nobody counted.
 *
 * WHAT COUNTS
 * -----------
 * The VISIBLE text of every `<p>` inside `<main>`. Visible is the operative
 * word: `innerText` returns nothing for a paragraph inside a collapsed
 * `<details>`, so supplemental reasoning behind a disclosure is not counted
 * here. That is not a hiding place - `progressive disclosure withholds
 * reasoning, never qualification` below is the test that stops it becoming one,
 * and it is the reason this budget can be about what a reader actually meets.
 *
 * Excluded: `.sr-only` text, which is an alternative rendering of something
 * already on the page rather than more of it; `<figcaption>`, which belongs to
 * the figure and not to the prose; and table cells, because a cell of a
 * comparison table is data. Headings, labels, list items, badges and figures are
 * not `<p>` elements and are not counted. None of them may be cut to meet this
 * budget: cutting a table column or a filter label to make a word count is the
 * wrong reading of the rule.
 *
 * Documented in portfolio/docs/CONTENT_MODEL.md.
 */
test.describe('the reference overview stays inside its prose budget', () => {
  /*
   * `UX.1` MOVED THE SUBJECT OF THIS RULE, NOT THE RULE.
   *
   * The budget was written for the marketing home page, whose whole job was
   * introduction and whose failure mode was an essay. That page is retired; its
   * store story, product tour and engineering proof are the technical overview,
   * and they inherited the budget with the content. The operating home has a
   * budget of its own below, and it is a different number because it is a
   * different kind of page.
   */
  const WORD_BUDGET = 450
  const ROUTE = '/technical?view=overview'

  test(`renders at most ${String(WORD_BUDGET)} words of visible prose`, async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    await mainText(page)
    const measured = await measureProse(page)

    expect(measured, `${ROUTE} has no <main>`).not.toBeNull()
    expect(
      measured!.total,
      `${ROUTE} renders ${String(measured!.total)} words of visible prose in ` +
        `${String(measured!.counted)} paragraphs, which is ` +
        `${String(measured!.total - WORD_BUDGET)} over the ${String(WORD_BUDGET)}-word budget. ` +
        `The longest paragraphs are: ${measured!.longest
          .map((entry) => `${String(entry.words)}w "${entry.text}"`)
          .join('; ')}. ` +
        'Move reference material or disclosure to the route whose subject it is ' +
        'rather than shortening a heading, a label or a table to fit.'
    ).toBeLessThanOrEqual(WORD_BUDGET)
  })
})

/**
 * The operating application's first-viewport contract (`UX.1` §17, §44).
 *
 * A DIFFERENT RULE FROM THE ONE ABOVE, AND DELIBERATELY SO. A console is not
 * short because it says little; it is dense because it says it in figures,
 * labels, axes and tables, none of which is prose. So the budget here is on the
 * FIRST VIEWPORT rather than on the page: what a manager has to read before they
 * can read a number.
 *
 * The pre-`UX.1` measurement that produced this rule is in
 * `docs/reviews/UX-1-BASELINE.md`: the first data visualization on `/dashboard`
 * began 2,194 px down a 900 px viewport.
 */
test.describe('the operating home opens on data', () => {
  const DESKTOP_FOLD_PROSE = 320
  const MOBILE_FOLD_PROSE = 200

  test('reaches its first visualization inside two screens', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, '/')
    const firstVisualY = await page.evaluate(() => {
      const main = document.querySelector('main')
      if (main === null) return -1
      const figure = main.querySelector('figure')
      if (figure === null) return -1
      return Math.round(figure.getBoundingClientRect().top + window.scrollY)
    })
    expect(
      firstVisualY,
      'the operating home renders no visualization at all'
    ).toBeGreaterThan(0)
    expect(
      firstVisualY,
      `the first visualization begins ${String(firstVisualY)} px down, which is more ` +
        'than two screens. It was 2,194 px before UX.1 and the whole increment was ' +
        'about that number.'
    ).toBeLessThan(1800)
  })

  test('opens with a heading, the scope and the controls, not with a lede', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    // The `h1` is a NAME. The rail says where the reader is; a sentence-length
    // heading on a working screen is an article title.
    const heading = await page.getByRole('heading', { level: 1 }).innerText()
    expect(heading.trim().split(/\s+/).length, `the h1 reads "${heading}"`).toBeLessThan(
      4
    )
    // And the filter form is in the same band.
    await expect(page.getByRole('form', { name: /filters/i }).first()).toBeVisible()
  })

  test('carries no marketing hero, badge row or provenance line above the figures', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, '/')
    const aboveFold = await page.evaluate(() => {
      const main = document.querySelector('main')
      if (main === null) return ''
      const parts: string[] = []
      for (const element of main.querySelectorAll('p, h1, h2, span')) {
        const box = element.getBoundingClientRect()
        if (box.top < 900 && box.bottom > 0 && box.height > 0) {
          parts.push((element as HTMLElement).innerText ?? '')
        }
      }
      return parts.join(' ')
    })
    for (const [what, pattern] of [
      ['a dataset version badge', /dataset v/i],
      ['a contract fingerprint', /contract [0-9a-f]{8}/i],
      ['a semantic-model status', /semantic model/i],
      ['a real-engine validation badge', /real-engine validation/i],
    ] as const) {
      expect(aboveFold, `${what} is in the operating home's first viewport`).not.toMatch(
        pattern
      )
    }
  })

  for (const [name, width, height, budget] of [
    ['desktop', 1440, 900, DESKTOP_FOLD_PROSE],
    ['mobile', 390, 844, MOBILE_FOLD_PROSE],
  ] as const) {
    test(`keeps first-viewport prose under ${String(budget)} words on ${name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      await gotoRendered(page, '/')
      const words = await page.evaluate((foldHeight) => {
        const main = document.querySelector('main')
        if (main === null) return 0
        let total = 0
        for (const paragraph of main.querySelectorAll('p')) {
          if (paragraph.closest('.sr-only, figcaption, td, th, caption')) continue
          if (paragraph.classList.contains('sr-only')) continue
          const box = paragraph.getBoundingClientRect()
          if (box.top >= foldHeight || box.height === 0) continue
          total += paragraph.innerText
            .split(/\s+/)
            .filter((token) => /[\p{L}\p{N}]/u.test(token)).length
        }
        return total
      }, height)
      expect(
        words,
        `the operating home renders ${String(words)} words of prose in the first ` +
          `${name} viewport, over the ${String(budget)}-word budget. Move an ` +
          'explanation into the methodology disclosure rather than shortening a label.'
      ).toBeLessThanOrEqual(budget)
    })
  }
})

/**
 * The prose measurement, shared by the budget above.
 */
async function measureProse(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main) return null

    const paragraphs = [...main.querySelectorAll('p')].filter((paragraph) => {
      if (paragraph.classList.contains('sr-only')) return false
      return !paragraph.closest('.sr-only, figcaption, td, th, caption')
    })

    const words = (value: string) =>
      value.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length

    const longest = paragraphs
      .map((paragraph) => ({
        words: words(paragraph.innerText),
        text: paragraph.innerText.trim().slice(0, 60),
      }))
      .filter((entry) => entry.words > 0)
      .sort((a, b) => b.words - a.words)
      .slice(0, 3)

    return {
      total: paragraphs.reduce((sum, paragraph) => sum + words(paragraph.innerText), 0),
      counted: paragraphs.filter((paragraph) => words(paragraph.innerText) > 0).length,
      longest,
    }
  })
}

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
/**
 * `UX.1` RETIRED THE HERO, AND THIS IS WHAT REPLACED ITS RULES.
 *
 * The old block asserted that the home page's hero carried exactly two calls to
 * action, no status badge, and its headline plus both actions on the first phone
 * screen. Those were the right rules for a landing page introducing a product a
 * reader could not yet see. `/` IS the product now, so the equivalent obligations
 * are the operating first-viewport contract above — no badge row, no marketing
 * hero, a name rather than a sentence, and the controls in the same band as the
 * heading.
 *
 * What survives here is the one rule that was never about the hero: the reference
 * domain still opens on the group and its three stores, and the author sentence
 * is still the `h1` of `/about` and of nowhere else.
 */
test.describe('the group context still names the group and its three stores', () => {
  test('names all three above the fold on a desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, '/technical?view=overview')
    const text = await mainText(page)
    for (const store of ['Granite Chevrolet', 'Granite Subaru', 'Granite Pre-Owned']) {
      expect(text, `${store} is missing from the group context`).toContain(store)
    }
  })

  test('does not make the author sentence the headline of anything but /about', async ({
    page,
  }) => {
    for (const route of ['/', '/technical', '/technical?view=overview', '/inventory']) {
      await gotoRendered(page, route)
      const headline = await page.getByRole('heading', { level: 1 }).innerText()
      expect(headline, route).not.toMatch(/run the dealership/i)
    }
    await gotoRendered(page, '/about')
    expect(await page.getByRole('heading', { level: 1 }).innerText()).toMatch(
      /run the dealership/i
    )
  })
})

test.describe('the engineering proof shows the strongest four counts', () => {
  test('sets exactly four figures as headline numerals', async ({ page }) => {
    await gotoRendered(page, '/technical?view=overview')
    await mainText(page)
    // The previous build showed seven at equal weight, three of which described
    // the size of a fictional dealer group. Finding B-03.
    const numerals = page.locator('#proof .text-numeral')
    await expect(numerals).toHaveCount(4)
  })

  test('shows the four agreed figures and none of the secondary ones by default', async ({
    page,
  }) => {
    // `UX.1` rehomed the engineering proof strip from the marketing home page to
    // the technical overview, which is where the product tour and the store story
    // went with it. The obligation is unchanged: every value a visitor can reach
    // must equal the manifest, which is generated from repository evidence.
    await gotoRendered(page, '/technical?view=overview')
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
    await gotoRendered(page, '/technical?view=overview')
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
    await gotoRendered(page, '/technical?view=data-model')
    const entity = page.getByRole('option', { name: /vehicle sale/i }).first()
    await expect(entity, 'no selectable entity found in the explorer').toBeVisible()
    await entity.click()
    await expect(entity).toHaveAttribute('aria-selected', 'true')
    expect(
      (await page.locator('main').innerText()).includes('\u2014'),
      'the data-model explorer renders an em dash once an entity is selected'
    ).toBe(false)

    await gotoRendered(page, '/technical?view=architecture')
    const node = page.getByRole('option').first()
    if ((await node.count()) > 0) {
      await node.click()
      expect((await page.locator('main').innerText()).includes('\u2014')).toBe(false)
    }

    await gotoRendered(page, '/technical?view=overview')
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

/**
 * These four moved from `/` to `/kpis` with the component they are about.
 *
 * Six governed domains with one definition each is reference material, and the
 * page whose subject it is was always the KPI catalogue. Nothing in the assertions
 * changed except the route they load, which is the point: the surface still has to
 * be a real tab set, still has to change its panel, and still has to show no value
 * in any domain, wherever it renders.
 */
test.describe('the operating view is a product surface, not a dashboard', () => {
  test('offers six domains as real tabs', async ({ page }) => {
    await gotoRendered(page, '/technical?view=kpis')
    const tablist = page.getByRole('tablist', { name: /analytical domain/i })
    await expect(tablist).toBeVisible()
    await expect(tablist.getByRole('tab')).toHaveCount(6)
    // Exactly one selected, always.
    await expect(tablist.locator('[aria-selected="true"]')).toHaveCount(1)
  })

  test('changes the panel when a domain is chosen, by click and by arrow key', async ({
    page,
  }) => {
    await gotoRendered(page, '/technical?view=kpis')
    const tablist = page.getByRole('tablist', { name: /analytical domain/i })
    // Scoped to `#operating-view`, not located by role alone. The home page now
    // carries four tab sets and a bare `getByRole('tabpanel')` resolves to all
    // of them.
    const panel = page.locator('#operating-view').getByRole('tabpanel')

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
    await gotoRendered(page, '/technical?view=kpis')
    const tablist = page.getByRole('tablist', { name: /analytical domain/i })
    const tabs = await tablist.getByRole('tab').all()

    for (const tab of tabs) {
      await tab.click()
      const panel = await page
        .locator('#operating-view')
        .getByRole('tabpanel')
        .innerText()
      // No currency, no percentage, no thousands-separated figure. A KPI
      // identifier such as KPI-GRS-001 is not a value and is allowed.
      expect(panel, 'a currency value appeared').not.toMatch(/[$£€]\s?\d/)
      expect(panel, 'a percentage appeared').not.toMatch(/\b\d+(\.\d+)?\s?%/)
      expect(panel, 'a formatted figure appeared').not.toMatch(/\b\d{1,3},\d{3}\b/)
    }
  })

  test('states that no engine has evaluated the measures it shows', async ({ page }) => {
    await gotoRendered(page, '/technical?view=kpis')
    const frame = page.locator('#operating-view')
    await expect(frame).toContainText(/no engine has evaluated these measures/i)
  })
})

/* -------------------------------------------------------------------------- */
/* Progressive disclosure                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The home page's default-visible prose was reduced by roughly a quarter in this
 * release by moving supplemental reasoning behind `<details>`.
 *
 * That is a good change and it is the exact change that turns into a bad one by
 * degrees: the next paragraph somebody wants off the page is a caveat, and a
 * caveat behind a control is a caveat the page is hoping nobody opens. These
 * tests draw the line and hold it.
 */
test.describe('progressive disclosure withholds reasoning, never qualification', () => {
  /**
   * What must be readable without opening anything, and where.
   *
   * The route is part of the rule now. The home page's word-count pass moved the
   * two long inventory disclaimers to `/governance`, which is the page whose
   * subject they are and which already published both, so the sentence "an
   * inventory summary is descriptive evidence ... not an analytical finding" is
   * asserted there and on `/inventory` rather than on a home page that no longer
   * says it. What the home page still owes a stranger who lands on it is the
   * trust line, and every clause of it is checked below.
   *
   * The property is identical on every row: the statement survives a filter that
   * strips the contents of every collapsed `<details>`. A qualification a reader
   * has to open is a qualification the page is hoping they will not.
   */
  const ALWAYS_VISIBLE: readonly {
    readonly label: string
    readonly path: string
    readonly pattern: RegExp
  }[] = [
    /*
      THE FIRST TWO ARE ON THE OPERATING HOME, AND THE OTHER THREE ARE NOT.

      `UX.1` made `/` the operating console. The two statements a reader must not
      be able to miss while looking at a gross figure — the group is fictional and
      the figures are synthetic — are in the control band's disclosure SUMMARY, so
      they survive the collapsed-details filter below and are above the fold at
      both viewport sizes.

      The other three describe the reference-data lane and the validation gate.
      They belong to the reader who went looking for provenance, and they are on
      the routes whose subject they are: the listing explorer for the first two,
      the technical status view for Gate 2. Asserting them on an operating screen
      would be asserting that a manager reading December gross must first read
      about a workbook capture date.
    */
    { label: 'the fictional-entity notice', path: '/', pattern: /fictional/i },
    { label: 'the synthetic-data statement', path: '/', pattern: /synthetic/i },
    {
      label: 'the sanitized-listing provenance',
      path: '/inventory',
      pattern: /sanitiz/i,
    },
    {
      label: 'the "listings are not sales" boundary',
      path: '/inventory',
      pattern: /listings, not sales results/i,
    },
    { label: 'the Gate 2 position', path: '/technical?view=status', pattern: /Gate 2/ },
    {
      label: 'the "not a performance result" boundary on /governance',
      path: '/governance',
      pattern: /not (an? )?(analytical finding|performance)/i,
    },
    {
      label: 'the "not a performance result" boundary on /inventory',
      path: '/inventory',
      pattern: /not (an? )?(analytical finding|performance)/i,
    },
  ]

  for (const entry of ALWAYS_VISIBLE) {
    test(`${entry.label} is readable without opening a disclosure`, async ({ page }) => {
      await gotoRendered(page, entry.path)

      // Read only the text that is NOT inside a collapsed <details>. If the
      // statement survives that filter, a reader who opens nothing still sees it.
      const openText = await page.evaluate(() => {
        const main = document.querySelector('main')
        if (!main) return ''
        const clone = main.cloneNode(true) as HTMLElement
        for (const details of clone.querySelectorAll('details:not([open])')) {
          for (const child of [...details.children]) {
            if (child.tagName.toLowerCase() !== 'SUMMARY'.toLowerCase()) child.remove()
          }
        }
        return (clone.textContent ?? '').replace(/\s+/g, ' ')
      })

      expect(openText, `${entry.label} is only reachable behind a disclosure`).toMatch(
        entry.pattern
      )
    })
  }

  test('every summary names what it opens rather than saying "learn more"', async ({
    page,
  }) => {
    const vague =
      /^(learn|read|see|show|view)( more| less| details?)?\.?$|^(more|details?|expand|additional information)\.?$/i

    // The routes that actually carry disclosures: the technical overview's
    // supplemental reasoning, and the chart table alternatives on `/inventory`.
    // `/technical?view=architecture` has none — its long form is the
    // always-present component list, which is a different and better answer to
    // the same problem.
    for (const path of ['/technical?view=overview', '/inventory']) {
      await gotoRendered(page, path)
      const labels = await page.locator('main details > summary').allInnerTexts()
      expect(labels.length, `${path} has no disclosures at all`).toBeGreaterThan(0)
      for (const label of labels) {
        const text = label.trim()
        expect(text, `${path}: "${text}" is a vague summary`).not.toMatch(vague)
        // Short enough to scan, long enough to be a question rather than a noun.
        expect(
          text.length,
          `${path}: "${text}" is too short to be concrete`
        ).toBeGreaterThan(12)
      }
    }
  })

  test('disclosure contents are server-rendered, not injected by script', async ({
    request,
  }) => {
    // The whole argument for `<details>` over a custom control: the text is in
    // the document whether or not JavaScript ran. A disclosure whose contents
    // arrive with hydration is hidden content, not progressive disclosure.
    const html = await (await request.get('/technical?view=overview')).text()
    expect(html).toContain('Why these stores cannot share one operating model')
    // And the paragraph behind that summary, not merely the summary itself.
    expect(html).toMatch(/allocation: the store orders into a build schedule/i)
  })

  test('a disclosure opens from the keyboard and reports its state', async ({ page }) => {
    await gotoRendered(page, '/technical?view=overview')
    // Located from the OUTSIDE in: `filter({ has })` takes a locator relative to
    // the element being filtered, so passing a page-rooted `main details >
    // summary` into it resolves to nothing and every assertion then times out
    // against an empty set.
    const details = page
      .locator('main details')
      .filter({ hasText: 'Why these stores cannot share one operating model' })
      .first()
    const summary = details.locator('summary').first()

    await expect(details).not.toHaveAttribute('open', /.*/)

    await summary.focus()
    await expect(summary).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(details).toHaveAttribute('open', /.*/)

    // And closes again, so the control is a toggle rather than a one-way reveal.
    await page.keyboard.press('Enter')
    await expect(details).not.toHaveAttribute('open', /.*/)
  })

  test('the rehomed home-page chapters survived the move', async ({ page }) => {
    // Disclosure reduces prose. It must not have been used to remove a chapter.
    //
    // `UX.1` retired the marketing home page and rehomed its sections rather than
    // deleting them: the store story and the product tour are the technical
    // overview, the engineering proof strip is below them, and the author
    // positioning is `/about`. What is genuinely gone is the hero, whose job was
    // to introduce a product the reader could not yet see, and the closing call to
    // action that followed it. This is the assertion that the other three are
    // still somewhere a reader can reach.
    await gotoRendered(page, '/technical?view=overview')
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('main section[id]')].map((node) => node.id)
    )
    expect(ids).toContain('stores')
    expect(ids).toContain('tour')
    await expect(page.locator('#proof')).toHaveCount(1)
  })
})

/* -------------------------------------------------------------------------- */
/* Business-result language                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The existing sweep above catches a business-result FIGURE: a gross, a revenue,
 * a margin with a number attached. This catches the sentence that makes the same
 * claim without one.
 *
 * "ARPI improved inventory turn" needs no figure to be a lie, and it is the exact
 * sentence a portfolio drifts toward under pressure to sound like it did
 * something. No analysis has been run against this platform, no report page
 * exists, Gate 2 is closed, and the inventory lane is a snapshot of what was
 * advertised on a date. There is no result to report, so there is no phrasing of
 * one that is honest.
 *
 * The patterns are deliberately narrow. `reduced` and `improved` are ordinary
 * English and appear legitimately - the site says the home page reduced its own
 * chapter count, and a KPI caution says a leaderboard "rewards whoever the lead
 * routing favours". Only the constructions that attach a change to a dealership
 * outcome are rejected.
 */
test.describe('no route claims a dealership result', () => {
  const RESULT_CLAIMS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
    {
      label: 'an asserted improvement in a retail outcome',
      pattern:
        /\b(increase[ds]?|improve[ds]?|lift(ed)?|boost(ed)?|grew|grow(th|n)?)\b[^.]{0,40}\b(sales|gross|revenue|profit|turn|days supply|close rate|conversion)\b/i,
    },
    {
      label: 'an asserted reduction in a retail outcome',
      pattern:
        /\b(reduce[ds]?|cut|lower(ed)?|shrank|decreas(e|ed))\b[^.]{0,40}\b(aged inventory|aging|days supply|holding cost|cost per (sale|unit))\b/i,
    },
    {
      label: 'a percentage change presented as an outcome',
      pattern:
        /\b\d+(\.\d+)?\s?%\s?(increase|improvement|lift|growth|reduction|uplift)\b/i,
    },
    {
      label: 'a return-on-investment claim',
      pattern: /\bROI\b|\breturn on (ad )?spend\b/i,
    },
    {
      label: 'a production-adoption claim',
      pattern:
        /\b(used|deployed|running|in production) (at|by|across) \d+ (dealership|store|rooftop)/i,
    },
    { label: 'a testimonial', pattern: /["“][^"”]{20,}["”]\s*[-—]\s*[A-Z][a-z]+ [A-Z]/ },
  ]

  for (const route of PRIMARY_ROUTES) {
    test(`${route.path} states no dealership outcome`, async ({ page }) => {
      await gotoRendered(page, route.path)
      const text = await bodyText(page)
      for (const claim of RESULT_CLAIMS) {
        const match = claim.pattern.exec(text)
        expect(
          match?.[0],
          `${route.path} contains ${claim.label}: "${match?.[0] ?? ''}"`
        ).toBeUndefined()
      }
    })
  }
})
