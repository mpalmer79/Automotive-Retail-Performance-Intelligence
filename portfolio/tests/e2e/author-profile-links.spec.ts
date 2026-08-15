/**
 * Where the author's profile links actually land, measured in a browser.
 *
 * WHY THIS IS SEPARATE FROM THE UNIT SUITE. `tests/unit/author-profile-links.test.tsx`
 * proves the anchors exist, point at the three destinations the site keeps apart, carry
 * safe external-link attributes, are keyboard reachable and follow the synthetic-data
 * disclosure in the document. Every one of those assertions passes on a badge rendered
 * at zero height behind the banner, because jsdom has no layout engine. The claims this
 * file makes are geometric and can only be made against a laid-out page:
 *
 *   Executive  the pair sits in the band's UPPER RIGHT at 1440, survives at 768, and
 *              stacks full width at 390 between the disclosure and the filters.
 *   About      the hero reads NAME, headline, two paragraphs, badges, trust line -
 *              in that order, down the page, at every width.
 *   masthead   two compact marks that do not collide with the navigation and do not
 *              overflow the bar, down to 320px.
 *   footer     the ARPI repository button and the two author badges, both present.
 *
 * And at every width, on every surface: no horizontal overflow.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoRendered } from './helpers'

const ROUTE = '/'

/*
 * THE THREE DESTINATIONS, TYPED OUT.
 *
 * The unit suite asserts the component against `lib/site.ts` so a badge cannot drift
 * from the constant. This file is the other half of that: the literal strings a visitor
 * would land on, so a change to the constant itself has to be a deliberate edit here
 * too. GITHUB_PORTFOLIO and REPOSITORY are both github.com/mpalmer79 URLs and the whole
 * increment is about not confusing them, which is why they are both spelled in full.
 */
const GITHUB_PORTFOLIO = 'https://github.com/mpalmer79'
const LINKEDIN_PROFILE = 'https://www.linkedin.com/in/mpalmer1234/'
const REPOSITORY =
  'https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence'

/** The three widths the increment names, plus the tablet reflow. */
const SIZES = [
  { label: 'narrow phone', width: 320, height: 844 },
  { label: 'phone', width: 390, height: 844 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'desktop', width: 1440, height: 900 },
] as const

/** The badge pair, wherever it is rendered. Excludes the masthead's compact marks. */
function badges(page: Page) {
  return page.locator('[data-profile-variant="badges"] a')
}

/**
 * A laid-out box with all four edges.
 *
 * `locator.boundingBox()` returns `x`, `y`, `width` and `height` and nothing else, so
 * `box.right` reads `undefined` and every comparison against it passes silently. Every
 * edge this file compares is computed here instead.
 */
async function box(
  page: Page,
  selector: string
): Promise<{
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}> {
  const found = await page.locator(selector).first().boundingBox()
  expect(found, `${selector} has no layout box`).not.toBeNull()
  const { x, y, width, height } = found!
  return { left: x, right: x + width, top: y, bottom: y + height, width, height }
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
}

/* -------------------------------------------------------------------------- */
/* Executive: present, safe and laid out at every width                        */
/* -------------------------------------------------------------------------- */

for (const size of SIZES.filter((s) => s.width >= 390)) {
  test(`renders both profile links on / at ${size.label} (${String(size.width)}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await gotoRendered(page, ROUTE)

    const links = badges(page)
    await expect(links).toHaveCount(2)

    const portfolio = links.nth(0)
    const profile = links.nth(1)

    await expect(portfolio).toBeVisible()
    await expect(profile).toBeVisible()

    // THE CORRECTION THIS INCREMENT MADE. The first badge was the ARPI repository
    // labelled "GitHub Repository"; it is the author's GitHub profile now, and the
    // repository is reached through its own explicitly labelled controls.
    await expect(portfolio).toHaveAttribute('href', GITHUB_PORTFOLIO)
    await expect(profile).toHaveAttribute('href', LINKEDIN_PROFILE)
    await expect(portfolio).toContainText('GitHub Portfolio')
    await expect(profile).toContainText('LinkedIn Profile')

    for (const link of [portfolio, profile]) {
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(link).toHaveAttribute('rel', /noopener/)
      await expect(link).toHaveAttribute('rel', /noreferrer/)
    }

    // A control a thumb can hit and an eye can read. 36 px is the design system's dense
    // control height and applies from `sm` up; a phone gets the 44 px floor because the
    // badges are full-width rows there with nothing beside them to lend the WCAG 2.2
    // spacing exception.
    const floor = size.width < 640 ? 44 : 36
    for (const link of [portfolio, profile]) {
      const measured = await link.boundingBox()
      expect(measured, 'the badge has no layout box').not.toBeNull()
      expect(measured!.height).toBeGreaterThanOrEqual(floor - 0.5)
      expect(measured!.width).toBeGreaterThan(96)
    }

    expect(await overflow(page), `${String(size.width)} px`).toBeLessThanOrEqual(1)
  })
}

/* -------------------------------------------------------------------------- */
/* Executive desktop: the upper right of the header band                       */
/* -------------------------------------------------------------------------- */

test.describe('at 1440 the pair occupies the header band, upper right', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('sits inside the operating band and not in the banner or the workspace', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)

    const band = await box(page, '[data-operating-band]')
    const links = await box(page, '[data-profile-links]')
    const title = await box(page, 'h1')
    const banner = await box(page, '[data-executive-banner]')
    const workspace = await box(page, '[data-visual-region]')
    const controls = await box(page, '[data-operating-controls]')

    // INSIDE THE BAND. The one containment assertion the whole increment is about: not
    // over the banner, not in the workspace, not in the rail, not in the footer.
    expect(links.top).toBeGreaterThanOrEqual(band.top - 1)
    expect(links.bottom).toBeLessThanOrEqual(band.bottom + 1)

    // RIGHT. Right of the title, and entirely in the band's right-hand half.
    expect(links.left).toBeGreaterThan(title.right)
    expect(links.left).toBeGreaterThan(band.left + band.width / 2)
    // Flush to the band's right edge rather than floating in the middle of it: the
    // action area is the corner, and a few pixels of slack allow for the badge's own
    // border without allowing the pair to drift inward.
    expect(band.right - links.right).toBeLessThan(8)

    // UPPER. In the band's top half, on the disclosure's row rather than pushed down
    // among the filter controls.
    expect(links.bottom).toBeLessThan(band.top + band.height / 2)

    // ABOVE THE CONTROLS, ABOVE THE BANNER, ABOVE THE WORKSPACE. The header band is the
    // first thing on the route and the badges are inside it, so everything the console
    // renders comes after them.
    expect(links.bottom).toBeLessThanOrEqual(controls.top + 1)
    expect(links.bottom).toBeLessThanOrEqual(banner.top + 1)
    expect(links.bottom).toBeLessThanOrEqual(workspace.top + 1)
  })

  test('leaves the synthetic-data disclosure ahead of it on the same row', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)

    await expect(page.locator('#trust')).toBeVisible()

    const pill = await box(page, '#trust')
    const links = await box(page, '[data-profile-links]')

    // The disclosure is to the LEFT of the badges on a desktop, which is the same
    // precedence the document order states: the reader meets the fictional-group
    // statement before the optional links whichever way they read the band.
    expect(pill.right).toBeLessThanOrEqual(links.left + 1)
    // And the pill kept a readable width rather than being crushed to make room.
    expect(pill.width).toBeGreaterThan(200)
  })
})

/* -------------------------------------------------------------------------- */
/* Executive tablet and phone: the reflow                                      */
/* -------------------------------------------------------------------------- */

test('at 768 both links survive without squeezing the title', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await gotoRendered(page, ROUTE)

  await expect(badges(page)).toHaveCount(2)

  const title = await box(page, 'h1')
  const links = await box(page, '[data-profile-links]')
  const band = await box(page, '[data-operating-band]')
  const controls = await box(page, '[data-operating-controls]')

  // The title keeps a readable column: the action area is allowed to wrap under the
  // disclosure at this width and is not allowed to take the heading's width to do it.
  expect(title.width).toBeGreaterThan(64)
  // Still in the band, still above the controls, still a row rather than a stack.
  expect(links.bottom).toBeLessThanOrEqual(band.bottom + 1)
  expect(links.bottom).toBeLessThanOrEqual(controls.top + 1)

  const first = await box(page, '[data-profile-links] a:nth-of-type(1)')
  const second = await box(page, '[data-profile-links] a:nth-of-type(2)')
  expect(Math.abs(first.top - second.top)).toBeLessThan(2)

  expect(await overflow(page)).toBeLessThanOrEqual(1)
})

test('at 390 the pair stacks after the disclosure and before the controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await gotoRendered(page, ROUTE)

  await expect(badges(page)).toHaveCount(2)

  const first = await box(page, '[data-profile-links] a:nth-of-type(1)')
  const second = await box(page, '[data-profile-links] a:nth-of-type(2)')
  const disclosure = await box(page, '#trust')
  const controls = await box(page, '[data-operating-controls]')
  const band = await box(page, '[data-operating-band]')

  // Stacked, not side by side: one row each, the second below the first.
  expect(second.top).toBeGreaterThanOrEqual(first.bottom - 1)
  expect(Math.abs(first.width - second.width)).toBeLessThan(2)
  // Full width of the band's content column, so they read as designed rows rather than
  // as desktop controls that happened to wrap.
  expect(first.width).toBeCloseTo(band.width, 0)

  // The reading order the band promises, measured rather than assumed.
  expect(first.top).toBeGreaterThanOrEqual(disclosure.bottom - 1)
  expect(second.bottom).toBeLessThanOrEqual(controls.top + 1)

  expect(await overflow(page)).toBeLessThanOrEqual(1)
})

/* -------------------------------------------------------------------------- */
/* Containment: the other operating routes                                     */
/* -------------------------------------------------------------------------- */

test('no other operating route grows a profile link', async ({ page }) => {
  const others = [
    '/dashboard/sales-gross',
    '/dashboard/deals',
    '/dashboard/inventory',
    '/dashboard/fi',
    '/dashboard/leads-marketing',
    '/dashboard/employees',
    '/dashboard/accounting',
    '/dashboard/actions',
  ]

  for (const route of others) {
    await gotoRendered(page, route)
    await expect(
      page.locator('[data-profile-links]'),
      `${route} grew a header action area`
    ).toHaveCount(0)
    // The rail's own repository link is site chrome and stays; what may not appear on
    // these routes is either of the author's personal profiles.
    for (const href of [LINKEDIN_PROFILE, GITHUB_PORTFOLIO]) {
      await expect(
        page.locator(`a[href="${href}"]`),
        `${route} links an author profile`
      ).toHaveCount(0)
    }
    // ...and the repository is still reachable from the rail, unchanged by any of this.
    await expect(
      page.locator(`a[href="${REPOSITORY}"]`).first(),
      `${route} lost the source repository link`
    ).toHaveCount(1)
  }
})

/* -------------------------------------------------------------------------- */
/* Keyboard                                                                    */
/* -------------------------------------------------------------------------- */

test('both links take focus from the keyboard and show a focus ring', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoRendered(page, ROUTE)

  for (const href of [GITHUB_PORTFOLIO, LINKEDIN_PROFILE]) {
    const link = page.locator(`[data-profile-links] a[href="${href}"]`)
    await link.focus()
    await expect(link).toBeFocused()

    // The site draws one focus ring with `outline` in `globals.css`. What is asserted
    // here is that this control did not opt out of it: a non-zero outline width in the
    // `:focus-visible` state, read off the computed style.
    const outline = await link.evaluate((node) => {
      const style = getComputedStyle(node)
      return { width: style.outlineWidth, style: style.outlineStyle }
    })
    expect(outline.style).not.toBe('none')
    expect(parseFloat(outline.width)).toBeGreaterThan(0)
  }
})

/* -------------------------------------------------------------------------- */
/* The About hero                                                              */
/* -------------------------------------------------------------------------- */

test.describe('the About hero says who built this', () => {
  test('reads name, headline, two paragraphs, badges, trust line - in that order', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, '/about')

    const name = page.getByText('Michael Palmer', { exact: true }).first()
    await expect(name).toBeVisible()

    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toContainText(
      'Dealership intelligence built by someone who has run the dealership'
    )
    // Exactly one h1, and the name is NOT part of it: it sits above it in the
    // hierarchy rather than being appended to the strongest sentence on the site.
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(heading).not.toContainText('Michael Palmer')

    const nameBox = await box(page, 'main p:has-text("Michael Palmer")')
    const headingBox = await box(page, 'h1')
    const heroBadges = await box(page, 'main [data-profile-variant="badges"]')
    // The header's trust line, identified by the clause only it renders.
    const trust = await box(page, 'main p:has-text("Deterministic synthetic data.")')

    expect(nameBox.bottom).toBeLessThanOrEqual(headingBox.top + 1)
    expect(headingBox.bottom).toBeLessThanOrEqual(heroBadges.top + 1)
    expect(heroBadges.bottom).toBeLessThanOrEqual(trust.top + 1)

    // Secondary to the headline, not competing with it.
    expect(heroBadges.height).toBeLessThan(headingBox.height)
  })

  test('links the GitHub portfolio and the LinkedIn profile inside the paragraphs', async ({
    page,
  }) => {
    await gotoRendered(page, '/about')

    const lede = page.getByRole('link', { name: /GitHub portfolio/i }).first()
    const supporting = page.getByRole('link', { name: /LinkedIn profile/i }).first()

    await expect(lede).toHaveAttribute('href', GITHUB_PORTFOLIO)
    await expect(supporting).toHaveAttribute('href', LINKEDIN_PROFILE)
    for (const link of [lede, supporting]) {
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(link).toHaveAttribute('rel', /noopener/)
      // An inline link inside running text, not a call-to-action block: it stays in
      // its paragraph and it is underlined rather than given a surface.
      const inParagraph = await link.evaluate((node) => node.closest('p') !== null)
      expect(inParagraph).toBe(true)
      const decoration = await link.evaluate(
        (node) => getComputedStyle(node).textDecorationLine
      )
      expect(decoration).toContain('underline')
    }
  })

  test('carries both profile badges and drops the design-history paragraph', async ({
    page,
  }) => {
    await gotoRendered(page, '/about')

    const hero = page.locator('main [data-profile-variant="badges"]')
    await expect(hero).toHaveCount(1)
    await expect(hero.locator(`a[href="${GITHUB_PORTFOLIO}"]`)).toContainText(
      'GitHub Portfolio'
    )
    await expect(hero.locator(`a[href="${LINKEDIN_PROFILE}"]`)).toContainText(
      'LinkedIn Profile'
    )

    const text = await page.locator('main').innerText()
    expect(text).not.toContain("ARPI home page's headline")
    // The ARPI repository is still on the page, under its own name.
    await expect(
      page.locator(`main a[href="${REPOSITORY}"]`).first(),
      'the About page lost its source repository link'
    ).toBeVisible()
  })

  test('shortens the breadcrumb to the destination name', async ({ page }) => {
    await gotoRendered(page, '/about')

    const trail = page.getByRole('navigation', { name: /breadcrumb/i })
    const text = (await trail.innerText()).replace(/\s+/g, ' ').trim()
    expect(text).toContain('About')
    expect(text).not.toContain('run the dealership')
  })

  for (const size of SIZES) {
    test(`the About hero does not overflow at ${String(size.width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await gotoRendered(page, '/about')

      await expect(page.locator('main [data-profile-variant="badges"] a')).toHaveCount(2)
      expect(await overflow(page)).toBeLessThanOrEqual(1)
    })
  }
})

/* -------------------------------------------------------------------------- */
/* The masthead and the mobile drawer                                          */
/* -------------------------------------------------------------------------- */

test.describe('the site masthead carries both professional destinations', () => {
  const REFERENCE_ROUTES = ['/about', '/technical', '/inventory']

  for (const route of REFERENCE_ROUTES) {
    test(`${route} offers both from the header at 1440`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await gotoRendered(page, route)

      const header = page.locator('header')
      const github = header.locator(`a[href="${GITHUB_PORTFOLIO}"]`)
      const linkedin = header.locator(`a[href="${LINKEDIN_PROFILE}"]`)

      await expect(github).toHaveCount(1)
      await expect(linkedin).toHaveCount(1)
      await expect(github).toHaveAccessibleName(/Michael Palmer on GitHub/i)
      await expect(linkedin).toHaveAccessibleName(/Michael Palmer on LinkedIn/i)
      for (const link of [github, linkedin]) {
        await expect(link).toHaveAttribute('target', '_blank')
        await expect(link).toHaveAccessibleName(/opens in a new tab/i)
      }

      // The masthead is the AUTHOR's action area now: the repository surrogate that
      // used to sit here is gone, and the repository is reached from the footer.
      await expect(header.locator(`a[href="${REPOSITORY}"]`)).toHaveCount(0)
    })
  }

  test('the compact marks clear the navigation and take a keyboard focus ring', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, '/about')

    const nav = await box(page, 'header nav[aria-label="Primary"]')
    const compact = await box(page, 'header [data-profile-variant="compact"]')
    const bar = await box(page, 'header > div')

    // Right of the primary navigation, inside the bar, and not overlapping either.
    expect(compact.left).toBeGreaterThanOrEqual(nav.right - 1)
    expect(compact.right).toBeLessThanOrEqual(bar.right + 1)
    expect(compact.top).toBeGreaterThanOrEqual(bar.top - 1)
    expect(compact.bottom).toBeLessThanOrEqual(bar.bottom + 1)

    for (const href of [GITHUB_PORTFOLIO, LINKEDIN_PROFILE]) {
      const link = page.locator(`header a[href="${href}"]`)
      // WCAG 2.2 target size, kept in the masthead rather than traded for space.
      const measured = await link.boundingBox()
      expect(measured!.height).toBeGreaterThanOrEqual(43.5)
      expect(measured!.width).toBeGreaterThanOrEqual(43.5)

      await link.focus()
      await expect(link).toBeFocused()
      const outline = await link.evaluate((node) => getComputedStyle(node).outlineStyle)
      expect(outline).not.toBe('none')
    }
  })

  for (const size of SIZES) {
    test(`the masthead does not overflow at ${String(size.width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await gotoRendered(page, '/about')

      const bar = await box(page, 'header > div')
      const compact = await box(page, 'header [data-profile-variant="compact"]')
      const wordmark = await box(page, 'header a[aria-label*="home"]')

      // 320px is the assertion that matters: wordmark, two marks and the menu button
      // in one bar, none of them on top of another, and no page-level scrollbar.
      expect(compact.left).toBeGreaterThanOrEqual(wordmark.right - 1)
      expect(compact.right).toBeLessThanOrEqual(bar.right + 1)
      expect(await overflow(page), `${String(size.width)} px`).toBeLessThanOrEqual(1)
    })
  }

  test('the mobile drawer names the author and labels both destinations', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoRendered(page, '/about')

    await page.getByRole('button', { name: /open navigation menu/i }).click()
    const drawer = page.locator('#mobile-navigation')
    await expect(drawer).toBeVisible()

    await expect(drawer.getByText('Michael Palmer', { exact: true })).toBeVisible()

    const github = drawer.locator(`a[href="${GITHUB_PORTFOLIO}"]`)
    const linkedin = drawer.locator(`a[href="${LINKEDIN_PROFILE}"]`)

    // Labelled, not bare glyphs: the drawer has room for the words and uses it.
    await expect(github).toContainText('GitHub Portfolio')
    await expect(linkedin).toContainText('LinkedIn Profile')

    for (const link of [github, linkedin]) {
      const measured = await link.boundingBox()
      expect(measured!.height).toBeGreaterThanOrEqual(43.5)
      // Keyboard reachable inside the focus trap.
      await link.focus()
      await expect(link).toBeFocused()
    }

    expect(await overflow(page)).toBeLessThanOrEqual(1)
  })
})

/* -------------------------------------------------------------------------- */
/* The footer: the person and the project, as two things                       */
/* -------------------------------------------------------------------------- */

test.describe('the footer separates the author from the repository', () => {
  test('carries the source repository button and both author badges', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, '/about')

    const footer = page.locator('footer')

    const repository = footer.getByRole('link', { name: /Source repository/i })
    await expect(repository).toHaveAttribute('href', REPOSITORY)

    const badgeRow = footer.locator('[data-profile-variant="badges"]')
    await expect(badgeRow).toHaveCount(1)
    await expect(badgeRow.locator(`a[href="${GITHUB_PORTFOLIO}"]`)).toContainText(
      'GitHub Portfolio'
    )
    await expect(badgeRow.locator(`a[href="${LINKEDIN_PROFILE}"]`)).toContainText(
      'LinkedIn Profile'
    )

    // Order is the information architecture: ARPI's code, then the person who wrote it.
    const repoBox = await box(page, 'footer a[href="' + REPOSITORY + '"]')
    const badgeBox = await box(page, 'footer [data-profile-variant="badges"]')
    expect(repoBox.bottom).toBeLessThanOrEqual(badgeBox.top + 1)
  })

  for (const size of SIZES) {
    test(`the footer column does not overflow at ${String(size.width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await gotoRendered(page, '/about')

      const footer = page.locator('footer')
      await expect(footer.locator('[data-profile-variant="badges"] a')).toHaveCount(2)

      const column = await box(page, 'footer [data-profile-variant="badges"]')
      const bounds = await box(page, 'footer')
      expect(column.right).toBeLessThanOrEqual(bounds.right + 1)

      expect(await overflow(page), `${String(size.width)} px`).toBeLessThanOrEqual(1)
    })
  }
})
