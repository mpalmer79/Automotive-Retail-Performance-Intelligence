/**
 * Where the Executive header's profile links actually land, measured in a browser.
 *
 * WHY THIS IS SEPARATE FROM THE UNIT SUITE. `tests/unit/executive-profile-links.test.tsx`
 * proves the two anchors exist, carry safe external-link attributes, are keyboard
 * reachable and follow the synthetic-data disclosure in the document. Every one of those
 * assertions passes on a badge rendered at zero height behind the banner, because jsdom
 * has no layout engine. The claim this file makes is geometric and can only be made
 * against a laid-out page:
 *
 *   desktop  the pair sits in the band's UPPER RIGHT — inside the operating band, right
 *            of the title, above the filters, and above the console rather than under
 *            the banner or inside the workspace.
 *   tablet   both survive, both are readable, and neither overflows.
 *   phone    they stack full width, after the scope line and the disclosure and before
 *            the filter controls, at a tappable height.
 *
 * And at every width: no horizontal overflow, and the disclosure still on the page.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoRendered } from './helpers'

const ROUTE = '/'

const REPOSITORY =
  'https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence'
const PROFILE = 'https://www.linkedin.com/in/mpalmer1234/'

/** The three widths the increment names. */
const SIZES = [
  { label: 'phone', width: 390, height: 844 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'desktop', width: 1440, height: 900 },
] as const

function badges(page: Page) {
  return page.locator('[data-profile-links] a')
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
/* Present, safe and laid out at all three widths                              */
/* -------------------------------------------------------------------------- */

for (const size of SIZES) {
  test(`renders both profile links on / at ${size.label} (${String(size.width)}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await gotoRendered(page, ROUTE)

    const links = badges(page)
    await expect(links).toHaveCount(2)

    const repository = links.nth(0)
    const profile = links.nth(1)

    await expect(repository).toBeVisible()
    await expect(profile).toBeVisible()
    await expect(repository).toHaveAttribute('href', REPOSITORY)
    await expect(profile).toHaveAttribute('href', PROFILE)

    for (const link of [repository, profile]) {
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(link).toHaveAttribute('rel', /noopener/)
      await expect(link).toHaveAttribute('rel', /noreferrer/)
    }

    // A control a thumb can hit and an eye can read. 36 px is the design system's dense
    // control height and applies from `sm` up; a phone gets the 44 px floor because the
    // badges are full-width rows there with nothing beside them to lend the WCAG 2.2
    // spacing exception.
    const floor = size.width < 640 ? 44 : 36
    for (const link of [repository, profile]) {
      const box = await link.boundingBox()
      expect(box, 'the badge has no layout box').not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(floor - 0.5)
      expect(box!.width).toBeGreaterThan(96)
    }

    expect(await overflow(page), `${String(size.width)} px`).toBeLessThanOrEqual(1)
  })
}

/* -------------------------------------------------------------------------- */
/* Desktop: the upper right of the header band                                 */
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
/* Tablet and phone: the reflow                                                */
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
    // The rail's own GitHub link is site chrome and stays; what may not appear on these
    // routes is the author's personal profile.
    await expect(
      page.locator(`a[href="${PROFILE}"]`),
      `${route} links the author profile`
    ).toHaveCount(0)
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

  for (const href of [REPOSITORY, PROFILE]) {
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
