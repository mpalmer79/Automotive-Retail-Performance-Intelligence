import { expect, test } from '@playwright/test'

import { bodyText, gotoRendered } from './helpers'
import {
  GROUP_ROUTES,
  HEADER_NAV,
  OPERATING_NAV_ROUTES,
  PERMANENT_REDIRECTS,
  PRIMARY_ROUTES,
  TECHNICAL_VIEW_ROUTES,
  UNBUILT_DASHBOARD_ROUTES,
} from './routes'

/**
 * Navigation, metadata, redirects and the 404.
 *
 * The route list this sweeps is an independent copy in `tests/e2e/routes.ts`
 * rather than an import of the app's own map, and `tests/unit/site.test.ts`
 * asserts the two agree — so a route removed from the app cannot silently vanish
 * from the test sweep as well.
 */

/* -------------------------------------------------------------------------- */
/* The operating application                                                   */
/* -------------------------------------------------------------------------- */

test.describe('the operating rail', () => {
  test('offers the nine built destinations and nothing else', async ({ page }) => {
    await gotoRendered(page, '/')
    const nav = page.getByRole('navigation', { name: 'Operating' }).first()
    await expect(nav.getByRole('link')).toHaveCount(OPERATING_NAV_ROUTES.length)

    for (const item of OPERATING_NAV_ROUTES) {
      await expect(nav.getByRole('link', { name: item.label, exact: true })).toHaveCount(
        1
      )
    }
  })

  test('never links to a section that is not built', async ({ page }) => {
    /*
     * `UNBUILT_DASHBOARD_ROUTES` is EMPTY as of `DASH.12`, which delivered the one section it
     * held. The assertion is unchanged in substance: whatever the list contains must not be
     * linked from anywhere in the application. It passed before because `/dashboard/actions`
     * was in the list and absent from the rail; it passes now because nothing is claimed to
     * be missing. A future entry that outlived its increment fails here.
     */
    for (const route of ['/', '/dashboard/sales-gross', '/dashboard/accounting']) {
      await gotoRendered(page, route)
      for (const unbuilt of UNBUILT_DASHBOARD_ROUTES) {
        await expect(
          page.locator(`a[href^="${unbuilt}"]`),
          `${route} -> ${unbuilt}`
        ).toHaveCount(0)
      }
    }
    // The counterpart claim, now that the rail is complete: Actions IS reachable.
    await gotoRendered(page, '/')
    await expect(page.locator('a[href^="/dashboard/actions"]').first()).toBeVisible()
  })

  test('marks exactly one destination current on every operating route', async ({
    page,
  }) => {
    for (const item of OPERATING_NAV_ROUTES) {
      await gotoRendered(page, item.path)
      const current = page
        .getByRole('navigation', { name: 'Operating' })
        .first()
        .locator('[aria-current="page"]')
      await expect(current, `${item.path} should mark ${item.label}`).toHaveCount(1)
      await expect(current).toContainText(item.label)
    }
  })

  test('marks Deals current inside a Deal Jacket', async ({ page }) => {
    // A drill-through is inside the section it was reached from. Marking F&I
    // current on a jacket that itemizes F&I would tell a reader they navigated
    // somewhere they did not.
    await gotoRendered(page, '/dashboard/deals/SLE-00000646')
    const current = page
      .getByRole('navigation', { name: 'Operating' })
      .first()
      .locator('[aria-current="page"]')
    await expect(current).toHaveCount(1)
    await expect(current).toContainText('Deals')
  })

  test('carries the demo statement on every operating screen', async ({ page }) => {
    for (const item of OPERATING_NAV_ROUTES) {
      await gotoRendered(page, item.path)
      const text = await bodyText(page)
      expect(text, item.path).toMatch(/Granite Auto Group is fictional/i)
    }
  })

  test('offers Technical and About as utilities rather than as peers', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    const utility = page.getByRole('navigation', { name: 'Utility' }).first()
    await expect(utility.getByRole('link', { name: 'Technical' })).toHaveAttribute(
      'href',
      '/technical'
    )
    await expect(utility.getByRole('link', { name: 'About' })).toHaveAttribute(
      'href',
      '/about'
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Filter continuity                                                           */
/* -------------------------------------------------------------------------- */

test.describe('the rail carries the analytical context', () => {
  test('preserves period and store across every applicable destination', async ({
    page,
  }) => {
    await gotoRendered(page, '/?period=2025-11&store=GSA-002')
    const nav = page.getByRole('navigation', { name: 'Operating' }).first()

    for (const item of OPERATING_NAV_ROUTES.filter((entry) => entry.path !== '/')) {
      const href = await nav
        .getByRole('link', { name: item.label, exact: true })
        .getAttribute('href')
      /*
       * STORE reaches every operating destination. PERIOD does not, and the one exception
       * is a design decision rather than a gap: `/dashboard/actions` declares `period`
       * not-applicable, because each action rule sets its own as-of scope and they differ
       * by domain — the as-of snapshot for inventory, the as-of month for deliveries, the
       * published exception register for accounting. A period control over rows selected on
       * three different bases would mean three different things at once, so it is dropped
       * rather than carried into a page that would show it doing nothing.
       *
       * The rule this test guards is unchanged: a parameter travels exactly when the
       * destination's support matrix says it applies, which is the same rule the next test
       * checks from the other direction.
       */
      expect(href, `${item.label} lost the store`).toContain('store=GSA-002')
      if (item.path === '/dashboard/actions') {
        expect(href, 'Actions must not carry a period it cannot apply').not.toContain(
          'period='
        )
        continue
      }
      expect(href, `${item.label} lost the period`).toContain('period=2025-11')
    }
  })

  test('drops a parameter the destination declares not applicable', async ({ page }) => {
    // `source` reaches the lead funnel and reaches nothing on the accounting
    // reconciliation. Carrying it there would render a chip claiming a lead source
    // is selected on a page whose every figure ignores it.
    await gotoRendered(page, '/?period=2025-11&source=LDS-007')
    const nav = page.getByRole('navigation', { name: 'Operating' }).first()

    const leads = await nav
      .getByRole('link', { name: 'Leads & Marketing', exact: true })
      .getAttribute('href')
    expect(leads).toContain('source=LDS-007')

    const accounting = await nav
      .getByRole('link', { name: 'Accounting', exact: true })
      .getAttribute('href')
    expect(accounting).toContain('period=2025-11')
    expect(accounting).not.toContain('source=')
  })

  test('survives an actual navigation, not only an href', async ({ page }) => {
    await gotoRendered(page, '/?period=2025-11&store=GSA-002')
    await page
      .getByRole('navigation', { name: 'Operating' })
      .first()
      .getByRole('link', { name: 'Sales & Gross', exact: true })
      .click()
    await expect(page).toHaveURL(/\/dashboard\/sales-gross\?/)
    expect(page.url()).toContain('period=2025-11')
    expect(page.url()).toContain('store=GSA-002')
  })

  test('produces the same links with scripting disabled', async ({ browser }) => {
    // The rail reads the query string in the browser, so this is the assertion
    // that the reading happens on the SERVER too and the no-JavaScript path keeps
    // its analytical context rather than silently resetting to the default period.
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto('/?period=2025-11&store=GSA-002')
    const href = await page
      .locator('a[href^="/dashboard/sales-gross"]')
      .first()
      .getAttribute('href')
    expect(href).toContain('period=2025-11')
    expect(href).toContain('store=GSA-002')
    await context.close()
  })

  test('never emits a duplicate parameter', async ({ page }) => {
    await gotoRendered(page, '/?period=2025-11&store=GSA-002&condition=Used')
    const hrefs = await page
      .locator('a[href*="?"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))
    for (const href of hrefs) {
      const query = href.split('?')[1]
      if (query === undefined) continue
      const keys = query.split('&').map((pair) => pair.split('=')[0])
      expect(new Set(keys).size, href).toBe(keys.length)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The reference domain                                                        */
/* -------------------------------------------------------------------------- */

test.describe('the reference header', () => {
  test('offers three destinations and nothing else', async ({ page }) => {
    await gotoRendered(page, '/technical')
    const nav = page.locator('header').getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link')).toHaveCount(HEADER_NAV.length)

    for (const item of HEADER_NAV) {
      await expect(nav.getByRole('link', { name: item.label })).toHaveAttribute(
        'href',
        item.path
      )
    }
  })

  test('opens with a link back into the operating application', async ({ page }) => {
    await gotoRendered(page, '/technical')
    const first = page
      .locator('header')
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link')
      .first()
    await expect(first).toHaveAttribute('href', '/')
    await expect(first).toHaveText('Executive')
  })

  test('keeps the locked case study out of the header', async ({ page }) => {
    await gotoRendered(page, '/technical')
    const nav = page.locator('header').getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link', { name: /case study/i })).toHaveCount(0)
  })

  test('still offers the case study, saying locked in words, in the footer', async ({
    page,
  }) => {
    await gotoRendered(page, '/technical')
    const caseStudy = page
      .locator('footer')
      .getByRole('link', { name: /case study/i })
      .first()
    await expect(caseStudy).toHaveAttribute('href', '/case-study')
    await expect(caseStudy).toHaveAccessibleName(/locked/i)
    await expect(caseStudy).toHaveAccessibleName(/gate 2 is closed/i)
  })

  test('marks exactly one item current on every reference route it names', async ({
    page,
  }) => {
    for (const item of HEADER_NAV.filter((entry) => entry.path !== '/')) {
      for (const path of item.currentOn) {
        await gotoRendered(page, path)
        const current = page
          .locator('header')
          .getByRole('navigation', { name: 'Primary' })
          .locator('[aria-current="page"]')
        await expect(current, `${path} should mark ${item.label}`).toHaveCount(1)
        await expect(current).toHaveText(item.label)
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The technical destination                                                   */
/* -------------------------------------------------------------------------- */

test.describe('the technical destination', () => {
  test('renders all eight views, each with its own heading', async ({ page }) => {
    const headings = new Set<string>()
    for (const view of TECHNICAL_VIEW_ROUTES) {
      const response = await page.goto(view.path)
      expect(response?.status(), view.path).toBe(200)
      const heading = await page.getByRole('heading', { level: 1 }).innerText()
      expect(headings.has(heading), `${view.path} duplicates a heading`).toBe(false)
      headings.add(heading)
    }
  })

  test('links every view from every view, as plain links and not a tab set', async ({
    page,
  }) => {
    for (const view of TECHNICAL_VIEW_ROUTES) {
      await gotoRendered(page, view.path)
      const nav = page.getByRole('navigation', { name: 'Technical views' })
      await expect(nav, view.path).toBeVisible()
      await expect(nav.getByRole('link')).toHaveCount(TECHNICAL_VIEW_ROUTES.length)
      // Announcing links as tabs promises arrow-key panel switching and no
      // navigation, and both are false: each view is a server-rendered document
      // at its own URL.
      //
      // SCOPED TO THE NAVIGATION, not to the page. The overview view carries the
      // store story and the product tour, which ARE real tab sets — panels
      // switched in place inside one document, with no URL of their own — and
      // banning `role="tablist"` from the whole page would be banning a correct
      // use of it to catch an incorrect one.
      await expect(nav.locator('[role="tablist"]'), view.path).toHaveCount(0)
      await expect(nav.locator('[role="tab"]'), view.path).toHaveCount(0)
    }
  })

  test('marks the current view and only the current view', async ({ page }) => {
    for (const view of TECHNICAL_VIEW_ROUTES) {
      await gotoRendered(page, view.path)
      const current = page
        .getByRole('navigation', { name: 'Technical views' })
        .locator('[aria-current="page"]')
      await expect(current, view.path).toHaveCount(1)
      await expect(current).toContainText(view.label)
    }
  })

  test('gives every view a canonical URL of its own state', async ({ page }) => {
    for (const view of TECHNICAL_VIEW_ROUTES) {
      await page.goto(view.path)
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
      expect(canonical, view.path).toContain(view.path)
    }
  })

  test('falls back to the overview for an unknown view rather than 404ing', async ({
    page,
  }) => {
    const response = await page.goto('/technical?view=not-a-view')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('How ARPI works')
    // And it says so, rather than silently showing something else.
    expect(await bodyText(page)).toMatch(/There is no .*not-a-view.* view/i)
  })

  test('states plainly that the product vision is not implemented', async ({ page }) => {
    await gotoRendered(page, '/technical?view=product-vision')
    const text = await bodyText(page)
    expect(text).toMatch(/Nothing on this page is implemented/i)
    expect(text).toMatch(/ARPI has no connection to any dealer management system/i)
  })

  test('works with scripting disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    for (const view of TECHNICAL_VIEW_ROUTES) {
      const response = await page.goto(view.path)
      expect(response?.status(), view.path).toBe(200)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }
    await context.close()
  })
})

/* -------------------------------------------------------------------------- */
/* Redirects                                                                   */
/* -------------------------------------------------------------------------- */

test.describe('the retired URLs', () => {
  for (const redirect of PERMANENT_REDIRECTS) {
    test(`${redirect.from} redirects permanently to ${redirect.to}`, async ({ page }) => {
      const response = await page.goto(redirect.from)
      expect(response?.status()).toBe(200)

      const landed = new URL(page.url())
      const target = new URL(redirect.to, 'http://localhost')
      expect(landed.pathname).toBe(target.pathname)
      expect(landed.searchParams.get('view')).toBe(target.searchParams.get('view'))

      // The status of the redirect itself, not only where it landed. A 302 here
      // would keep search engines re-fetching a path that is never coming back.
      const chain = response?.request().redirectedFrom()
      expect(chain, `${redirect.from} did not redirect at all`).toBeTruthy()
      const redirectResponse = await chain?.response()
      expect([301, 308]).toContain(redirectResponse?.status())
    })
  }

  test('/dashboard carries its filters through the redirect', async ({ page }) => {
    // THE MOST LOAD-BEARING ASSERTION IN THIS FILE. Every console link anybody has
    // shared, bookmarked or pasted into a document is a `/dashboard?...` URL. A
    // redirect that dropped the query would resolve all of them to the default
    // period and the whole group, silently, and the page would look fine.
    const response = await page.goto('/dashboard?period=2025-11&store=GSA-002')
    expect(response?.status()).toBe(200)
    const landed = new URL(page.url())
    expect(landed.pathname).toBe('/')
    expect(landed.searchParams.get('period')).toBe('2025-11')
    expect(landed.searchParams.get('store')).toBe('GSA-002')
  })

  test('/dashboard does not take the operating sub-routes with it', async ({ page }) => {
    for (const item of OPERATING_NAV_ROUTES.filter((entry) => entry.path !== '/')) {
      const response = await page.goto(item.path)
      expect(response?.status(), item.path).toBe(200)
      expect(new URL(page.url()).pathname, item.path).toBe(item.path)
    }
  })

  test('/dealerships does not take the store routes with it', async ({ page }) => {
    for (const route of PRIMARY_ROUTES.filter((entry) =>
      entry.path.startsWith('/dealerships/')
    )) {
      const response = await page.goto(route.path)
      expect(response?.status(), route.path).toBe(200)
      expect(new URL(page.url()).pathname, route.path).toBe(route.path)
    }
  })

  test('leaves no retired URL in the sitemap', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text()
    for (const redirect of PERMANENT_REDIRECTS) {
      expect(
        xml,
        `${redirect.from} is a redirect and must not be in the sitemap`
      ).not.toMatch(new RegExp(`<loc>[^<]*${redirect.from}</loc>`))
    }
  })

  test('produces exactly one canonical document per URL', async ({ page }) => {
    // The duplication the consolidation exists to prevent: two URLs rendering the
    // same document, each claiming to be canonical.
    const canonicals = new Map<string, string[]>()
    // `TECHNICAL_VIEW_ROUTES` already opens with `/technical`, so the list is
    // deduplicated rather than written out: a path checked twice would claim its
    // own canonical twice and fail a rule it does not break.
    for (const path of [
      ...new Set([
        '/',
        '/technical',
        ...TECHNICAL_VIEW_ROUTES.map((view) => view.path),
        '/about',
        '/inventory',
      ]),
    ]) {
      await page.goto(path)
      const canonical =
        (await page.locator('link[rel="canonical"]').getAttribute('href')) ?? ''
      canonicals.set(canonical, [...(canonicals.get(canonical) ?? []), path])
    }
    for (const [canonical, paths] of canonicals) {
      expect(paths.length, `${canonical} is claimed by ${paths.join(', ')}`).toBe(1)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Mobile                                                                      */
/* -------------------------------------------------------------------------- */

test.describe('mobile navigation', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the operating drawer is unmounted until opened and offers every destination', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    await expect(page.locator('#operating-navigation')).toHaveCount(0)

    const trigger = page.getByRole('button', { name: /open navigation menu/i })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()

    const drawer = page.locator('#operating-navigation')
    await expect(drawer).toBeVisible()
    await expect(
      page.getByRole('button', { name: /close navigation menu/i })
    ).toHaveAttribute('aria-expanded', 'true')

    for (const item of OPERATING_NAV_ROUTES) {
      await expect(
        drawer.getByRole('link', { name: new RegExp(escapeRegExp(item.label)) }).first(),
        `${item.label} is missing from the drawer`
      ).toBeVisible()
    }
    await expect(drawer.getByRole('link', { name: /Technical/ })).toBeVisible()
  })

  test('the operating drawer closes on a route change and unlocks the scroll', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    await page.getByRole('button', { name: /open navigation menu/i }).click()
    await page
      .locator('#operating-navigation')
      .getByRole('link', { name: /Accounting/ })
      .first()
      .click()

    await expect(page).toHaveURL(/\/dashboard\/accounting/)
    await expect(page.locator('#operating-navigation')).toHaveCount(0)
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  })

  test('the reference drawer offers the header items and the technical views', async ({
    page,
  }) => {
    await gotoRendered(page, '/about')
    await expect(page.locator('#mobile-navigation')).toHaveCount(0)
    await page.getByRole('button', { name: /open navigation menu/i }).click()

    const drawer = page.locator('#mobile-navigation')
    await expect(drawer).toBeVisible()

    const primaryList = drawer.locator('nav > ul').first()
    for (const item of HEADER_NAV) {
      await expect(
        primaryList.getByRole('link', { name: new RegExp(item.label) }),
        `${item.label} is missing from the drawer`
      ).toBeVisible()
    }

    for (const route of [...TECHNICAL_VIEW_ROUTES, ...GROUP_ROUTES]) {
      await expect(
        drawer.getByRole('link', { name: route.label, exact: true }).first(),
        `${route.label} is missing from the drawer's expanded groups`
      ).toBeVisible()
    }
  })

  test('keeps no reachable link inside a closed drawer', async ({ page }) => {
    await gotoRendered(page, '/')
    await expect(page.locator('#operating-navigation')).toHaveCount(0)

    const reachableButInvisible = await page.$$eval<number, HTMLElement>(
      'a, button',
      (controls) =>
        controls.filter((control) => {
          if (control.offsetParent === null) return false
          if (control.closest('.sr-only-focusable, .sr-only')) return false
          if (control.classList.contains('sr-only-focusable')) return false
          const box = control.getBoundingClientRect()
          return box.width === 0 || box.height === 0
        }).length
    )
    expect(reachableButInvisible).toBe(0)
  })

  test('hides the desktop rail with display, not with opacity', async ({ page }) => {
    await gotoRendered(page, '/')
    const display = await page
      .locator('nav[aria-label="Operating"]')
      .first()
      .evaluate((element) => {
        let node: HTMLElement | null = element as HTMLElement
        while (node !== null) {
          if (getComputedStyle(node).display === 'none') return 'none'
          node = node.parentElement
        }
        return 'visible'
      })
    expect(display).toBe('none')
  })
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* -------------------------------------------------------------------------- */
/* Metadata and discovery                                                      */
/* -------------------------------------------------------------------------- */

test.describe('metadata and discovery', () => {
  test('gives every route a unique title, description and canonical URL', async ({
    page,
  }) => {
    const titles = new Set<string>()
    const descriptions = new Set<string>()

    for (const route of PRIMARY_ROUTES) {
      await page.goto(route.path)
      const title = await page.title()
      const description = await page
        .locator('meta[name="description"]')
        .getAttribute('content')
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')

      expect(title.length, `${route.path} has no title`).toBeGreaterThan(10)
      expect(description, `${route.path} has no description`).toBeTruthy()
      expect(canonical, `${route.path} has no canonical URL`).toContain(route.path)

      expect(titles.has(title), `${route.path} duplicates the title "${title}"`).toBe(
        false
      )
      expect(
        descriptions.has(description ?? ''),
        `${route.path} duplicates a description`
      ).toBe(false)
      titles.add(title)
      descriptions.add(description ?? '')
    }
  })

  test('leads the root preview with the product rather than with the stack', async ({
    page,
  }) => {
    await page.goto('/')
    const description =
      (await page.locator('meta[name="description"]').getAttribute('content')) ?? ''
    expect(description).toMatch(/operating view of a dealer group/i)
    expect(description).toMatch(/fictional/i)
    // The stack may be described on the technical destination; it may not be the
    // first thing a shared link says about the product.
    expect(description).not.toMatch(/PostgreSQL|Power BI|Python/i)
  })

  test('does not render the home page title as "ARPI - ARPI"', async ({ page }) => {
    await page.goto('/')
    expect(await page.title()).toBe('Automotive Retail Performance Intelligence')
  })

  test('applies the title suffix exactly once on every route', async ({ page }) => {
    /*
     * The sibling test above guards the home page, which returns an ABSOLUTE title.
     * This guards the other shape of the same defect, which shipped: a route that
     * builds its own `"<name> - ARPI"` string and returns it as a plain string gets
     * the root template's suffix appended a SECOND time. `/technical` served
     * `How ARPI works - ARPI - ARPI` until `DASH.13` — on the route a technical
     * reviewer arriving from a shared link is most likely to open.
     *
     * Asserted over every primary route rather than just `/technical`, because the
     * mistake is available to any route that composes its own title.
     */
    for (const route of PRIMARY_ROUTES) {
      await page.goto(route.path)
      const title = await page.title()
      expect(title, `${route.path} doubles the title suffix`).not.toMatch(
        / - ARPI - ARPI/
      )
      expect(title, `${route.path} has an empty title`).not.toBe('')
    }
  })

  test('names the site in the social card metadata on every route', async ({ page }) => {
    /*
     * `og:site_name` was absent from every route until `DASH.13`: `pageMetadata()`
     * returns a fresh `openGraph` object and `Metadata` overrides are shallow, so
     * the root layout's value was replaced rather than merged. A social crawler
     * renders it as the card's attribution line, so a card built from a page without
     * it is a headline and an image with nothing naming the site they came from.
     */
    for (const route of PRIMARY_ROUTES) {
      await page.goto(route.path)
      await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
        'content',
        'Automotive Retail Performance Intelligence'
      )
    }
  })

  test('serves an Open Graph image and a Twitter card on every route', async ({
    page,
  }) => {
    for (const route of PRIMARY_ROUTES) {
      await page.goto(route.path)
      await expect(page.locator('meta[property="og:image"]')).toHaveCount(1)
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        'content',
        'summary_large_image'
      )
    }
  })

  test('serves the social preview image itself', async ({ request }) => {
    const response = await request.get('/brand/social-preview.png')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')

    // Really 1200x630, read from the IHDR of the bytes that were served rather
    // than from the committed file: the tag declares that geometry to every
    // crawler, and a card that is not really that size is cropped by the
    // platform.
    const bytes = await response.body()
    expect(bytes.toString('ascii', 12, 16)).toBe('IHDR')
    expect(bytes.readUInt32BE(16)).toBe(1200)
    expect(bytes.readUInt32BE(20)).toBe(630)
  })

  test('no longer serves the retired social preview from the site root', async ({
    request,
  }) => {
    // `/social-preview.png` was the card until it moved into `brand/`. Nothing
    // may answer there from a committed public asset: a stale second card is
    // exactly what this migration removed.
    const response = await request.get('/social-preview.png')
    expect(response.status()).toBe(404)
  })

  test('the Open Graph and Twitter tags both name the canonical card', async ({
    page,
  }) => {
    await page.goto('/')
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      const content = await page.locator(selector).first().getAttribute('content')
      expect(content, selector).toContain('/brand/social-preview.png')
    }
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      'content',
      '1200'
    )
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
      'content',
      '630'
    )
  })

  test('serves a sitemap listing every indexable route and excluding the UI lab', async ({
    request,
  }) => {
    const response = await request.get('/sitemap.xml')
    expect(response.status()).toBe(200)
    const xml = await response.text()
    for (const route of PRIMARY_ROUTES) {
      expect(xml, `sitemap is missing ${route.path}`).toContain(`${route.path}</loc>`)
    }
    // The seven non-default technical views, which are documents a reader can
    // share and a crawler can reach.
    for (const view of TECHNICAL_VIEW_ROUTES.filter(
      (entry) => entry.path !== '/technical'
    )) {
      const query = view.path.split('?')[1] ?? ''
      expect(xml, `sitemap is missing ${view.path}`).toContain(query)
    }
    expect(xml, 'the UI lab must not be in the sitemap').not.toContain('/ui-lab')
  })

  test('disallows the UI lab in robots.txt', async ({ request }) => {
    const response = await request.get('/robots.txt')
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain('/ui-lab')
  })

  test('marks the UI lab noindex in its own head', async ({ page }) => {
    await page.goto('/ui-lab')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/
    )
  })

  test('serves a web manifest and a favicon', async ({ request }) => {
    expect((await request.get('/manifest.webmanifest')).status()).toBe(200)
    expect((await request.get('/favicon.svg')).status()).toBe(200)
    expect((await request.get('/favicon-32.png')).status()).toBe(200)
    expect((await request.get('/apple-touch-icon.png')).status()).toBe(200)
  })

  test('serves exactly one JSON-LD graph, with only the four honest types', async ({
    page,
  }) => {
    await page.goto('/')
    const blocks = page.locator('script[type="application/ld+json"]')
    await expect(blocks).toHaveCount(1)
    const payload = JSON.parse((await blocks.first().textContent()) ?? '{}') as {
      '@graph': { '@type': string }[]
    }
    const types = payload['@graph'].map((node) => node['@type']).sort()
    expect(types).toEqual(['CreativeWork', 'Person', 'SoftwareSourceCode', 'WebSite'])
  })
})

/* -------------------------------------------------------------------------- */
/* External links                                                              */
/* -------------------------------------------------------------------------- */

test.describe('external links', () => {
  test('every external link opens in a new tab with a safe rel', async ({ page }) => {
    for (const route of PRIMARY_ROUTES) {
      await page.goto(route.path)
      const externals = await page.$$eval('a[href^="http"]', (anchors) =>
        anchors.map((anchor) => ({
          href: anchor.getAttribute('href') ?? '',
          target: anchor.getAttribute('target'),
          rel: anchor.getAttribute('rel') ?? '',
        }))
      )
      expect(externals.length, `${route.path} has no external link`).toBeGreaterThan(0)
      for (const link of externals) {
        expect(link.target, `${link.href} on ${route.path}`).toBe('_blank')
        expect(link.rel, `${link.href} on ${route.path}`).toContain('noopener')
      }
    }
  })

  test('points at the real repository and at no other host', async ({ page }) => {
    await page.goto('/technical')
    const hosts = await page.$$eval('a[href^="http"]', (anchors) => [
      ...new Set(anchors.map((anchor) => new URL(anchor.getAttribute('href')!).host)),
    ])
    expect(hosts).toEqual(['github.com'])
  })

  test('links every source path to a file on the default branch', async ({ page }) => {
    await page.goto('/technical?view=status')
    const sources = await page.$$eval(
      'a[href*="/blob/main/"], a[href*="/tree/main/"]',
      (anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? '')
    )
    expect(sources.length).toBeGreaterThan(10)
    for (const href of sources) {
      expect(href).toMatch(
        /^https:\/\/github\.com\/mpalmer79\/Automotive-Retail-Performance-Intelligence\/(?:blob|tree)\/main\/.+/
      )
      // A trailing slash or a double slash would 404 on GitHub.
      expect(href).not.toMatch(/\/$/)
      expect(href.replace('https://', '')).not.toContain('//')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The 404                                                                     */
/* -------------------------------------------------------------------------- */

test.describe('the 404 page', () => {
  test('returns a useful page that lists every route', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Page not found')
    await expect(page.getByRole('link', { name: /back to the overview/i })).toBeVisible()
  })

  test('is not indexed', async ({ page }) => {
    await page.goto('/this-route-does-not-exist')
    const contents = await page
      .locator('meta[name="robots"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''))
    expect(contents.length).toBeGreaterThan(0)
    expect(contents.every((content) => content.includes('noindex'))).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* The information architecture                                                */
/* -------------------------------------------------------------------------- */

test.describe('the operating console is the home page', () => {
  test('the root route answers 200 and opens on the Executive surface', async ({
    page,
  }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Executive')
  })

  test('the root page is not a marketing landing page', async ({ page }) => {
    // The specific regression this guards: a hero, a store story or a closing call
    // to action being restored in front of the application "as well".
    await gotoRendered(page, '/')
    const text = await bodyText(page)
    for (const [what, pattern] of [
      [
        'the old hero headline',
        /Three dealerships\. Three operating models\. One governed reporting layer\./i,
      ],
      ['the career essay', /computer science retraining/i],
      ['the analytical philosophy essay', /analytical philosophy/i],
    ] as const) {
      expect(text, `${what} is back on the operating home page`).not.toMatch(pattern)
    }
  })

  test('/about is where the author headline lives', async ({ page }) => {
    await gotoRendered(page, '/about')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Dealership intelligence built by someone who has run the dealership'
    )
  })

  test('/about carries the career and technical-transition material', async ({
    page,
  }) => {
    await gotoRendered(page, '/about')
    const text = await bodyText(page)
    expect(text, 'career length').toMatch(/more than 25 years/i)
    expect(text, 'dealership systems').toMatch(/CRM and DMS administration/i)
    expect(text, 'technical transition').toMatch(/computer science/i)
    expect(text, 'analytical philosophy').toMatch(/analytical philosophy/i)
  })

  test('/about carries the three decisions that came from the floor', async ({
    page,
  }) => {
    await gotoRendered(page, '/about')
    const text = await bodyText(page)
    expect(text, 'the section heading').toMatch(
      /three decisions that came from the floor/i
    )
    expect(text, 'the gross decision').toMatch(/never summed early/i)
    expect(text, 'the ranking decision').toMatch(/volume alone never ranks a person/i)
    expect(text, 'the aged-inventory decision').toMatch(/median age leads/i)
    expect(text, 'the artefact references').toMatch(/KPI-GRS-001/)
    expect(text, 'the argument').toMatch(/destroys the diagnosis/i)
  })

  test('the store story survives on the technical overview', async ({ page }) => {
    // The retired home page's sections were REHOMED, not deleted. If this fails,
    // the consolidation lost content rather than moving it.
    await gotoRendered(page, '/technical?view=overview')
    const text = await bodyText(page)
    expect(text, 'the group context').toMatch(/Granite/i)
    for (const store of GROUP_ROUTES.filter((route) =>
      route.path.startsWith('/dealerships/')
    )) {
      expect(text, `${store.label} is missing from the group context`).toContain(
        store.label
      )
    }
  })
})

test.describe('the two inventory surfaces are no longer ambiguous', () => {
  test('the rail means the operating surface', async ({ page }) => {
    await gotoRendered(page, '/')
    const href = await page
      .getByRole('navigation', { name: 'Operating' })
      .first()
      .getByRole('link', { name: 'Inventory', exact: true })
      .getAttribute('href')
    expect(href).toContain('/dashboard/inventory')
  })

  test('the reference explorer is labelled as listings and is not in the rail', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    await expect(
      page
        .getByRole('navigation', { name: 'Operating' })
        .first()
        .locator('a[href^="/inventory"]')
    ).toHaveCount(0)

    await gotoRendered(page, '/inventory')
    const text = await bodyText(page)
    expect(text).toMatch(/Listings, not sales results|sanitized public reference data/i)
  })
})

test.describe('breadcrumbs on a store page', () => {
  test('name the group and resolve to the group context', async ({ page }) => {
    await gotoRendered(page, '/dealerships/granite-subaru')
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(crumbs).toBeVisible()
    const groupCrumb = crumbs.getByRole('link', { name: 'Granite Auto Group' })
    await expect(groupCrumb).toHaveAttribute('href', '/technical?view=overview')
    // And the trail does not contain a link to the retired path.
    const hrefs = await crumbs
      .locator('a')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))
    expect(hrefs).not.toContain('/dealerships')
  })

  test('the store links on the technical overview reach each store', async ({ page }) => {
    for (const route of PRIMARY_ROUTES.filter((entry) =>
      entry.path.startsWith('/dealerships/')
    )) {
      await gotoRendered(page, '/technical?view=overview')
      const link = page.locator(`main a[href="${route.path}"]`).first()
      await link.scrollIntoViewIfNeeded()
      await link.click()
      await expect(page).toHaveURL(new RegExp(`${route.path}$`))
    }
  })
})
