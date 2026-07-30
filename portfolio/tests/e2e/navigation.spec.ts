import { expect, test } from '@playwright/test'

import { gotoRendered } from './helpers'
import { PRIMARY_ROUTES } from './routes'

/**
 * Navigation, metadata and the 404.
 *
 * The route list this sweeps is an independent copy in `tests/e2e/routes.ts`
 * rather than an import of the app's own map, and the first test asserts the two
 * agree - so a route removed from the app cannot silently vanish from the test
 * sweep as well.
 */

test.describe('primary navigation', () => {
  test('offers exactly the seven primary routes plus a distinct case-study entry', async ({
    page,
  }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    const links = nav.getByRole('link')
    // Seven primary labels plus the case study.
    await expect(links).toHaveCount(8)

    for (const route of PRIMARY_ROUTES.filter((r) => r.inNav)) {
      await expect(nav.getByRole('link', { name: route.navLabel! })).toHaveAttribute(
        'href',
        route.path
      )
    }
  })

  test('marks the case-study entry as locked, in text and not only with an icon', async ({
    page,
  }) => {
    await page.goto('/')
    const caseStudy = page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: /case study/i })
    await expect(caseStudy).toHaveAccessibleName(/locked/i)
    await expect(caseStudy).toHaveAccessibleName(/gate 2 is closed/i)
  })

  test('never labels the case study complete', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav).not.toContainText(/complete/i)
  })

  test('marks the current route with aria-current on every page', async ({ page }) => {
    for (const route of PRIMARY_ROUTES.filter((r) => r.inNav)) {
      await page.goto(route.path)
      const current = page
        .getByRole('navigation', { name: 'Primary' })
        .locator('[aria-current="page"]')
      await expect(current).toHaveCount(1)
      await expect(current).toHaveText(route.navLabel!)
    }
  })

  test('navigates between every pair of adjacent routes without a full reload', async ({
    page,
  }) => {
    await page.goto('/')
    const inNav = PRIMARY_ROUTES.filter((r) => r.inNav)
    for (const route of inNav.slice(1)) {
      await page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: route.navLabel! })
        .click()
      await expect(page).toHaveURL(new RegExp(`${route.path.replace('/', '\\/')}$`))
      await expect(page.getByRole('heading', { level: 1 })).toContainText(route.heading)
    }
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

    for (const route of PRIMARY_ROUTES.filter((r) => r.inNav)) {
      await expect(
        drawer.getByRole('link', { name: new RegExp(route.navLabel!) })
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
    // A taller viewport than the rest of this group uses. At 375x812 the eight
    // drawer rows plus their secondary lines fill the entire area below the
    // header, so no scrim is exposed and there is nothing to click - the close
    // button and Escape are the only ways out at that height, and both are
    // covered elsewhere. This viewport leaves the scrim visible so the behaviour
    // can actually be exercised.
    await page.setViewportSize({ width: 375, height: 1100 })
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
