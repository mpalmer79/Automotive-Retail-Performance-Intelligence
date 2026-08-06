import { expect, test } from '@playwright/test'

import { bodyText, gotoRendered } from './helpers'
import { GROUP_ROUTES, HEADER_NAV, PLATFORM_ROUTES, PRIMARY_ROUTES } from './routes'

/**
 * Navigation, metadata and the 404.
 *
 * The route list this sweeps is an independent copy in `tests/e2e/routes.ts`
 * rather than an import of the app's own map, and the first test asserts the two
 * agree - so a route removed from the app cannot silently vanish from the test
 * sweep as well.
 */

test.describe('primary navigation', () => {
  test('offers exactly five content destinations and nothing else', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    // Five, not seven. Architecture, the data model and governance are grouped
    // under "Platform"; the locked case study is out of the header entirely.
    await expect(nav.getByRole('link')).toHaveCount(HEADER_NAV.length)

    for (const item of HEADER_NAV) {
      await expect(nav.getByRole('link', { name: item.label })).toHaveAttribute(
        'href',
        item.path
      )
    }
  })

  test('keeps the locked case study out of the header', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link', { name: /case study/i })).toHaveCount(0)
  })

  test('still offers the case study, saying locked in words, in the footer', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    const caseStudy = page
      .locator('footer')
      .getByRole('link', { name: /case study/i })
      .first()
    await expect(caseStudy).toHaveAttribute('href', '/case-study')
    await expect(caseStudy).toHaveAccessibleName(/locked/i)
    await expect(caseStudy).toHaveAccessibleName(/gate 2 is closed/i)
  })

  test('never labels the case study complete', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav).not.toContainText(/complete/i)
  })

  test('marks exactly one item current on every navigable route', async ({ page }) => {
    for (const item of HEADER_NAV) {
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

  test('navigates between every header destination without a full reload', async ({
    page,
  }) => {
    await page.goto('/')
    for (const item of HEADER_NAV.slice(1)) {
      await page
        .locator('header')
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: item.label })
        .click()
      await expect(page).toHaveURL(new RegExp(`${item.path.replace('/', '\\/')}$`))
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }
  })
})

test.describe('the platform sub-navigation', () => {
  /**
   * The whole justification for a five-item header: a visitor who arrives at
   * Architecture from "Platform" must be able to see, without scrolling, that
   * the data model and the governance rules belong with it. If this navigation
   * is missing from any of the three, two routes have been hidden rather than
   * grouped.
   */
  test('appears on all three platform routes and links all three', async ({ page }) => {
    for (const route of PLATFORM_ROUTES) {
      await gotoRendered(page, route.path)
      const nav = page.getByRole('navigation', { name: 'Platform' })
      await expect(nav, `${route.path} has no platform navigation`).toBeVisible()
      for (const sibling of PLATFORM_ROUTES) {
        await expect(nav.getByRole('link', { name: sibling.label })).toHaveAttribute(
          'href',
          sibling.path
        )
      }
    }
  })

  test('marks its own page current, and only its own', async ({ page }) => {
    for (const route of PLATFORM_ROUTES) {
      await gotoRendered(page, route.path)
      const current = page
        .getByRole('navigation', { name: 'Platform' })
        .locator('[aria-current="page"]')
      await expect(current).toHaveCount(1)
      await expect(current).toContainText(route.label)
    }
  })

  test('does not appear on a route outside the platform group', async ({ page }) => {
    for (const path of ['/', '/kpis', '/status', '/about']) {
      await gotoRendered(page, path)
      await expect(page.getByRole('navigation', { name: 'Platform' }), path).toHaveCount(
        0
      )
    }
  })

  test('reaches the data model and governance in one click from Platform', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    await page
      .locator('header')
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Platform' })
      .click()
    await expect(page).toHaveURL(/\/architecture$/)

    await page
      .getByRole('navigation', { name: 'Platform' })
      .getByRole('link', { name: 'Data model' })
      .click()
    await expect(page).toHaveURL(/\/data-model$/)
  })
})

test.describe('mobile navigation', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('is hidden until opened, and offers every primary route when open', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.locator('#mobile-navigation')).toHaveCount(0)

    const trigger = page.getByRole('button', { name: /open navigation menu/i })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()

    const drawer = page.locator('#mobile-navigation')
    await expect(drawer).toBeVisible()
    await expect(
      page.getByRole('button', { name: /close navigation menu/i })
    ).toHaveAttribute('aria-expanded', 'true')

    // Scoped to the drawer's PRIMARY list, not to the whole drawer.
    //
    // The drawer also carries two expanded destination groups below that list,
    // and "Inventory" appears in both - once as a primary item and once as
    // "Inventory explorer" inside the group. An unscoped name match resolves to
    // two links and fails in strict mode, which is the test telling the truth
    // about the DOM rather than a defect in it.
    const primaryList = drawer.locator('nav > ul').first()
    for (const item of HEADER_NAV) {
      await expect(
        primaryList.getByRole('link', { name: new RegExp(item.label) }),
        `${item.label} is missing from the drawer`
      ).toBeVisible()
    }

    // And both destination groups, expanded. On a phone there is room to show
    // them rather than making a visitor land on Architecture or on the group page
    // and then discover a sub-navigation, so no route is more than one tap away.
    for (const route of [...PLATFORM_ROUTES, ...GROUP_ROUTES]) {
      await expect(
        drawer.getByRole('link', { name: route.label, exact: true }),
        `${route.label} is missing from the drawer's expanded groups`
      ).toBeVisible()
    }
  })

  test('closes when a route is chosen, and does not leave the scroll locked', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /open navigation menu/i }).click()
    await page
      .locator('#mobile-navigation')
      .getByRole('link', { name: /Governance/ })
      .click()

    await expect(page).toHaveURL(/\/governance$/)
    await expect(page.locator('#mobile-navigation')).toHaveCount(0)
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  })

  test('closes when the scrim is clicked', async ({ page }) => {
    // A taller viewport than the rest of this group uses. The drawer's rows plus
    // their secondary lines and the expanded platform group fill the entire area
    // below the header at 375x812, so no scrim is exposed and there is nothing to
    // click - the close button and Escape are the only ways out at that height,
    // and both are covered elsewhere. This viewport leaves the scrim visible so
    // the behaviour can actually be exercised.
    await page.setViewportSize({ width: 375, height: 1400 })
    await gotoRendered(page, '/about')
    await page.getByRole('button', { name: /open navigation menu/i }).click()

    const drawer = page.locator('#mobile-navigation')
    await expect(drawer).toBeVisible()

    const box = await drawer.boundingBox()
    const viewport = page.viewportSize()!
    const targetY = box!.y + box!.height + 40
    expect(
      targetY,
      'the drawer fills the viewport, so no scrim is exposed to click'
    ).toBeLessThan(viewport.height - 10)

    await page.mouse.click(viewport.width / 2, targetY)
    await expect(drawer).toHaveCount(0)
  })

  test('keeps no reachable link inside the closed drawer', async ({ page }) => {
    await page.goto('/')
    // The drawer is UNMOUNTED when closed rather than hidden, so there is no set
    // of links that exists in the DOM but cannot be reached. An earlier version
    // of this test measured bounding boxes and flagged the desktop navigation,
    // whose links sit inside a `display: none` ancestor at this width - correctly
    // removed from both the tab order and the accessibility tree, and not a trap.
    await expect(page.locator('#mobile-navigation')).toHaveCount(0)

    const reachableButInvisible = await page.$$eval<number, HTMLElement>(
      'a, button',
      (controls) =>
        controls.filter((control) => {
          // `offsetParent === null` means the control is inside a `display: none`
          // subtree, which is the correct way to hide something.
          if (control.offsetParent === null) return false
          if (control.closest('.sr-only-focusable, .sr-only')) return false
          if (control.classList.contains('sr-only-focusable')) return false
          const box = control.getBoundingClientRect()
          return box.width === 0 || box.height === 0
        }).length
    )
    expect(reachableButInvisible).toBe(0)
  })

  test('hides the desktop navigation with display, not with opacity', async ({
    page,
  }) => {
    await page.goto('/')
    // A nav hidden with opacity or visibility stays in the tab order, which is
    // the classic way a mobile layout ends up with fourteen invisible tab stops.
    // Queried by CSS, not by role: `getByRole` excludes hidden elements, so a
    // role query for something we expect to be hidden can never resolve.
    const display = await page
      .locator('header nav[aria-label="Primary"]')
      .first()
      .evaluate((element) => getComputedStyle(element).display)
    expect(display).toBe('none')
  })
})

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

  test('does not render the home page title as "ARPI - ARPI"', async ({ page }) => {
    await page.goto('/')
    expect(await page.title()).toBe('Automotive Retail Performance Intelligence')
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
    const response = await request.get('/social-preview.png')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
  })

  test('serves a sitemap listing eight indexable routes and excluding the UI lab', async ({
    request,
  }) => {
    const response = await request.get('/sitemap.xml')
    expect(response.status()).toBe(200)
    const xml = await response.text()
    for (const route of PRIMARY_ROUTES) {
      expect(xml, `sitemap is missing ${route.path}`).toContain(`${route.path}</loc>`)
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
    await page.goto('/')
    const hosts = await page.$$eval('a[href^="http"]', (anchors) => [
      ...new Set(anchors.map((anchor) => new URL(anchor.getAttribute('href')!).host)),
    ])
    expect(hosts).toEqual(['github.com'])
  })

  test('links every source path to a file on the default branch', async ({ page }) => {
    await page.goto('/status')
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

test.describe('the 404 page', () => {
  test('returns a useful page that lists every route', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Page not found')

    // The route map, not an apology.
    for (const route of PRIMARY_ROUTES.filter((r) => r.inNav)) {
      await expect(
        page.getByRole('link', { name: new RegExp(route.navLabel!) }).first()
      ).toBeVisible()
    }
    await expect(page.getByRole('link', { name: /back to the overview/i })).toBeVisible()
  })

  test('is not indexed', async ({ page }) => {
    await page.goto('/this-route-does-not-exist')
    // Next emits its own `noindex` for a not-found response, and the route's
    // metadata adds `noindex, nofollow`. Two nodes is correct, so the assertion
    // is on the collection rather than on a single one.
    const contents = await page
      .locator('meta[name="robots"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''))
    expect(contents.length).toBeGreaterThan(0)
    expect(contents.every((content) => content.includes('noindex'))).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* The information architecture                                               */
/* -------------------------------------------------------------------------- */

test.describe('the group overview is the home page', () => {
  test('the root route answers 200 and leads with the product', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Three dealerships. Three operating models. One governed reporting layer.'
    )
  })

  test('the root heading is not the author headline', async ({ page }) => {
    // The specific regression this guards: the two pages swapping back, or the
    // author sentence being restored to `/` "as well".
    await gotoRendered(page, '/')
    const heading = await page.getByRole('heading', { level: 1 }).innerText()
    expect(heading).not.toMatch(/built by someone who has run the dealership/i)
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

  test('the home page carries no long-form author section', async ({ page }) => {
    // WHAT THIS RULE PROTECTS, AND WHAT CHANGED
    //
    // The concern has never been that the author is mentioned on the home page.
    // It is that the same STORY gets told twice at two lengths, so the shorter
    // copy quietly goes stale against the longer one. The rule used to enforce
    // that by banning a phrase, which stopped being the right instrument when
    // the home page grew a deliberate builder chapter: a scannable list of role
    // functions is a fact set, and two pages agreeing on a fact set is
    // consistency rather than drift.
    //
    // So the rule now names the NARRATIVE. The three long-form passages below
    // are `/about`'s own prose, they are asserted present there by the test
    // above, and none of them may appear here.
    await gotoRendered(page, '/')
    const text = await bodyText(page)
    for (const [what, pattern] of [
      [
        'the career essay',
        /which reports get used and which get closed without reading/i,
      ],
      ['the retraining narrative', /computer science retraining/i],
      ['the analytical philosophy essay', /analytical philosophy/i],
    ] as const) {
      expect(text, `${what} is duplicated on the home page`).not.toMatch(pattern)
    }

    // The permitted clause, the link out, and the one section the author
    // material is allowed to occupy.
    expect(text).toMatch(/more than 25 years in automotive retail/i)
    await expect(page.getByRole('link', { name: 'About the author' })).toBeVisible()
    await expect(page.locator('#builder')).toHaveCount(1)
    await expect(
      page.locator('#builder').getByRole('link', { name: /the full background/i })
    ).toBeVisible()
  })
})

test.describe('the retired /dealerships path', () => {
  test('redirects permanently to the home page', async ({ page }) => {
    const response = await page.goto('/dealerships')
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe('/')

    // The status of the redirect itself, not only where it landed. A 302 here
    // would keep search engines re-fetching a path that is never coming back.
    const chain = response?.request().redirectedFrom()
    expect(chain, '/dealerships did not redirect at all').toBeTruthy()
    const redirectResponse = await chain?.response()
    expect([301, 308]).toContain(redirectResponse?.status())
  })

  test('does not take the store routes with it', async ({ page }) => {
    // The whole reason the redirect is declared on the exact path. A prefix rule
    // would send every deep link to the home page and silently break every
    // bookmark into a store.
    for (const route of PRIMARY_ROUTES.filter((entry) =>
      entry.path.startsWith('/dealerships/')
    )) {
      const response = await page.goto(route.path)
      expect(response?.status(), route.path).toBe(200)
      expect(new URL(page.url()).pathname, route.path).toBe(route.path)
    }
  })

  test('is absent from the sitemap, which lists the destination instead', async ({
    request,
  }) => {
    const xml = await (await request.get('/sitemap.xml')).text()
    expect(xml).not.toContain('<loc>http://127.0.0.1:3210/dealerships</loc>')
    expect(xml).toMatch(/<loc>[^<]*\/dealerships\/granite-chevrolet<\/loc>/)
  })
})

test.describe('breadcrumbs on a store page', () => {
  test('name the group and resolve to the home page', async ({ page }) => {
    await gotoRendered(page, '/dealerships/granite-subaru')
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(crumbs).toBeVisible()
    const groupCrumb = crumbs.getByRole('link', { name: 'Granite Auto Group' })
    await expect(groupCrumb).toHaveAttribute('href', '/')
    // And the trail does not contain a link to the retired path.
    const hrefs = await crumbs
      .locator('a')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))
    expect(hrefs).not.toContain('/dealerships')
  })

  test('the store links on the home page reach each store', async ({ page }) => {
    await gotoRendered(page, '/')
    for (const route of PRIMARY_ROUTES.filter((entry) =>
      entry.path.startsWith('/dealerships/')
    )) {
      await gotoRendered(page, '/')
      const link = page.locator(`main a[href="${route.path}"]`).first()
      await link.scrollIntoViewIfNeeded()
      await link.click()
      await expect(page).toHaveURL(new RegExp(`${route.path}$`))
    }
  })
})
