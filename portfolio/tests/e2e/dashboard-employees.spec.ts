import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { bodyText, gotoRendered, mainText, mainTextContent, settle } from './helpers'
import { DASHBOARD_VIEWPORTS } from './routes'

/**
 * `/dashboard/employees` in a browser.
 *
 * WHAT THESE TESTS ARE FOR. The unit suite proves the arithmetic and the fairness contract
 * against the model. These prove the things only a browser can: that the role state is really
 * in the URL, that the page is complete without JavaScript, that the below-floor state renders
 * as words rather than as a number, that no ranking control exists to click, and that axe finds
 * nothing serious on any of the four surfaces.
 *
 * THE BELOW-FLOOR SCOPE IS REAL COMMITTED DATA, not a fixture. December 2025 puts most
 * salespeople under the floor on the development profile, and `dashboard-employees.test.ts`
 * fails if that ever stops being true — so this test cannot quietly become vacuous.
 */

const ROUTE = '/dashboard/employees'

/**
 * Rendered page text, lower-cased.
 *
 * Several labels on this page are uppercased by CSS, and `innerText` applies `text-transform`,
 * so `MINIMUM SAMPLE` is what a case-sensitive assertion would have to match. Comparing in one
 * case keeps these tests about WHAT the page says rather than about how it is styled.
 */
async function lowerText(page: Page): Promise<string> {
  return (await mainText(page)).toLowerCase()
}

const ROLES = [
  { slug: 'salesperson', label: 'Salesperson', href: ROUTE },
  { slug: 'desk', label: 'Desk management', href: `${ROUTE}?role=desk` },
  { slug: 'finance', label: 'Finance', href: `${ROUTE}?role=finance` },
  { slug: 'bdc', label: 'BDC', href: `${ROUTE}?role=bdc` },
] as const

/* -------------------------------------------------------------------------- */
/* Role navigation is URL state                                                */
/* -------------------------------------------------------------------------- */

test.describe('the role family is addressable', () => {
  for (const role of ROLES) {
    test(`renders the ${role.slug} surface from the URL alone`, async ({ page }) => {
      await gotoRendered(page, role.href)
      const nav = page.getByRole('navigation', { name: 'Employee role family' })
      await expect(nav).toBeVisible()
      await expect(
        nav.getByRole('link', { name: role.label, exact: true })
      ).toHaveAttribute('aria-current', 'page')
      // The surface actually changed, not just the highlight. `UX.2C` replaced the region
      // heading with the family rail, whose module names the family and whose volume label
      // is the one that family is credited in.
      await expect(page.getByRole('heading', { name: 'This role family' })).toBeVisible()
      await expect(page.locator('#summary')).toContainText('People credited')
      await expect(page.locator('#summary')).toContainText(
        'Comparison-eligible on the leading figure'
      )
    })
  }

  test('survives reload, Back and Forward', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    await page
      .getByRole('navigation', { name: 'Employee role family' })
      .getByRole('link', { name: 'BDC', exact: true })
      .click()
    await expect(page).toHaveURL(/role=bdc/)

    await page.reload()
    await expect(page).toHaveURL(/role=bdc/)
    await expect(
      page
        .getByRole('navigation', { name: 'Employee role family' })
        .getByRole('link', { name: 'BDC', exact: true })
    ).toHaveAttribute('aria-current', 'page')

    await page.goBack()
    await expect(page).not.toHaveURL(/role=bdc/)
    await page.goForward()
    await expect(page).toHaveURL(/role=bdc/)
  })

  test('falls back to the default surface on an unrecognised role', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?role=nonsense`)
    await expect(
      page
        .getByRole('navigation', { name: 'Employee role family' })
        .getByRole('link', { name: 'Salesperson', exact: true })
    ).toHaveAttribute('aria-current', 'page')
  })

  test('is a real navigation landmark and not a mislabelled tab set', async ({
    page,
  }) => {
    // ARIA tab semantics promise roving focus and `aria-selected` behaviour that plain links
    // do not implement. Claiming them would be worse than not claiming them.
    await gotoRendered(page, ROUTE)
    expect(
      await page.locator('[role="tablist"], [role="tab"], [role="tabpanel"]').count()
    ).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Sample discipline, as the reader sees it                                    */
/* -------------------------------------------------------------------------- */

test.describe('the minimum sample is visible in the rendering', () => {
  test('renders a below-floor employee as words, with the count that caused it', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-12`)
    const text = await lowerText(page)

    expect(text, 'the committed below-floor scope has gone').toContain(
      'insufficient sample'
    )
    // THE DENOMINATOR THAT CAUSED THE SUPPRESSION IS PUBLISHED BESIDE IT. `UX.2C` made it a
    // chip -- "Sample 9 of 10 retail units" -- so both the count and the floor are still on
    // the row that carries the withheld figure.
    expect(text).toMatch(/sample \d+ of \d+ retail units/)

    // AND THE SUPPRESSED FIGURE IS NOT PRINTED AS A NUMBER. A suppressed row must not carry
    // "$0" or "0.0%" in place of the ratio, because those are false statements rather than
    // withheld ones.
    const suppressedRow = page
      .locator('li[data-employee]')
      .filter({ hasText: 'Insufficient sample' })
      .first()
    await expect(suppressedRow).toBeVisible()
    const rowText = (await suppressedRow.innerText()).replace(/\s+/g, ' ')
    expect(rowText).not.toMatch(/gross per retail unit\s*\$0\b/i)
    expect(rowText).not.toMatch(/\b0\.0%/)
  })

  test('states the floor and how many people are below it', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-12`)
    const text = await lowerText(page)
    expect(text).toContain('minimum sample')
    expect(text).toContain('below it')
    expect(text).toContain('publication discipline, not a performance threshold')
  })

  test('shows each rate with its own denominator on the BDC surface', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?role=bdc`)
    const text = await lowerText(page)
    for (const label of [
      'valid leads',
      'contacted leads',
      'eligible appointments',
      'shown appointments',
    ]) {
      expect(text, `no sample labelled "${label}"`).toContain(label)
    }
    // The appointment-set denominator is CONTACTED leads and the page says so.
    expect(text).toMatch(/n \d+ contacted leads/)
    // And the two grains are drawn apart rather than left to be inferred.
    expect(text).toContain('lead grain')
    expect(text).toContain('appointment grain')
  })
})

/* -------------------------------------------------------------------------- */
/* Fairness context and the non-ranking contract                               */
/* -------------------------------------------------------------------------- */

test.describe('the page carries its context and offers no ranking', () => {
  test('puts tenure, store and mix beside the figures rather than in a drawer', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const row = page.locator('li[data-employee]').first()
    const rowText = (await row.innerText()).toLowerCase()
    expect(rowText).toContain('tenure')
    expect(rowText).toMatch(/gsa-\d{3}/)
    expect(rowText).toContain('new and used mix')
    expect(rowText).toContain('assigned leads')
  })

  test('offers no control that sorts by a measure', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const controls = await page.locator('a, button, select, input').all()
    for (const control of controls) {
      const label = (
        (await control.getAttribute('aria-label')) ?? (await control.innerText())
      )
        .toLowerCase()
        .trim()
      for (const banned of ['sort by', 'rank', 'top ', 'best', 'worst', 'leaderboard']) {
        expect(label.includes(banned), `a control offers "${banned}": ${label}`).toBe(
          false
        )
      }
    }
  })

  test('lists people in business-key order and not in volume order', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const codes = await page
      .locator('li[data-employee]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-employee') ?? '')
      )
    expect(codes.length).toBeGreaterThan(1)
    // Within one store the codes ascend; the whole list is store-major.
    const stores = await page
      .locator('li[data-employee]')
      .evaluateAll((nodes) =>
        nodes.map((node) => /GSA-\d{3}/.exec(node.textContent ?? '')?.[0] ?? '')
      )
    expect(stores).toEqual([...stores].sort())
  })

  test('shows activity credited to nobody rather than dropping it', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?role=finance`)
    const text = await lowerText(page)
    expect(text).toContain('activity credited to nobody')
    expect(text).toContain('nobody on the f&i desk')
  })

  test('reports an unknown employee code instead of rendering an empty page', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?employee=EMP-99999`)
    await expect(page.getByRole('status')).toContainText('No employee')
    // The comparison is still there: an empty page would have implied a person with no activity.
    expect(await page.locator('li[data-employee]').count()).toBeGreaterThan(0)
  })

  test('carries no personnel field, image or gamification mark', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = (await bodyText(page)).toLowerCase()
    for (const banned of [
      'hire date',
      'termination',
      'salary',
      'commission',
      'pay plan',
      'bonus',
      'date of birth',
      'top performer',
      'underperform',
    ]) {
      expect(text.includes(banned), `the page says "${banned}"`).toBe(false)
    }
    // No employee portrait, avatar or badge image of any kind.
    const images = await page.locator('main img').count()
    expect(images).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Drill-through                                                               */
/* -------------------------------------------------------------------------- */

test.describe('drill-through only points where the parameter is honoured', () => {
  test('carries the employee code to F&I, which applies it', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?role=finance`)
    const first = page.locator('li[data-employee]').first()
    const code = await first.getAttribute('data-employee')
    expect(code).toBeTruthy()
    await first.getByRole('link', { name: code ?? '' }).click()
    await expect(page).toHaveURL(new RegExp(`employee=${code ?? ''}`))

    const link = page.getByRole('link', { name: 'F&I detail for this manager' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', new RegExp(`employee=${code ?? ''}`))
  })

  test('does not pretend the BDC funnel is person-scoped', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?role=bdc`)
    const first = page.locator('li[data-employee]').first()
    const code = await first.getAttribute('data-employee')
    await first.getByRole('link', { name: code ?? '' }).click()

    const link = page.getByRole('link', {
      name: 'Leads and marketing for these stores and period',
    })
    await expect(link).toBeVisible()
    const href = (await link.getAttribute('href')) ?? ''
    expect(href).not.toContain('employee=')
  })
})

/* -------------------------------------------------------------------------- */
/* No JavaScript                                                               */
/* -------------------------------------------------------------------------- */

test.describe('the page is complete without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  for (const role of ROLES) {
    test(`renders the ${role.slug} surface`, async ({ page }) => {
      await page.goto(role.href)
      // `mainText` scrolls the page to settle reveals, which needs scripting. With
      // JavaScript disabled the document is already complete, so its text is read directly —
      // and `textContent` also reaches inside the closed methodology disclosure.
      const text = (await mainTextContent(page)).toLowerCase()
      expect(text).toContain('this role family')
      expect(text).toContain('credited activity, by person')
      expect(text).toContain('minimum sample')
      expect(await page.locator('li[data-employee]').count()).toBeGreaterThan(0)
    })
  }

  test('navigates between role families by link', async ({ page }) => {
    await page.goto(ROUTE)
    await page
      .getByRole('navigation', { name: 'Employee role family' })
      .getByRole('link', { name: 'Finance', exact: true })
      .click()
    await expect(page).toHaveURL(/role=finance/)
    expect((await mainTextContent(page)).toLowerCase()).toContain('finance structure')
  })

  test('renders the suppression state, the context and the methodology', async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?period=2025-12`)
    const text = (await mainTextContent(page)).toLowerCase()
    expect(text).toContain('insufficient sample')
    expect(text).toMatch(/sample \d+ of \d+ retail units/)
    expect(text).toContain('tenure')
    expect(text).toContain('average active units')
    // The disclosure is a native <details>, so its contents are in the document even closed.
    expect(text).toContain('every ratio is a ratio of sums')
  })

  test('selects an employee by link', async ({ page }) => {
    await page.goto(`${ROUTE}?role=finance`)
    const first = page.locator('li[data-employee]').first()
    const code = await first.getAttribute('data-employee')
    await first.getByRole('link', { name: code ?? '' }).click()
    expect((await mainTextContent(page)).toLowerCase()).toContain(
      `${(code ?? '').toLowerCase()} in this period`
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Accessibility                                                               */
/* -------------------------------------------------------------------------- */

test.describe('axe finds nothing serious on any surface', () => {
  const states = [
    { name: 'default', href: ROUTE },
    { name: 'desk', href: `${ROUTE}?role=desk` },
    { name: 'finance', href: `${ROUTE}?role=finance` },
    { name: 'bdc', href: `${ROUTE}?role=bdc` },
    { name: 'below floor', href: `${ROUTE}?period=2025-12` },
    { name: 'selected employee', href: `${ROUTE}?role=finance&employee=EMP-00005` },
    { name: 'unknown employee', href: `${ROUTE}?employee=EMP-99999` },
  ]

  for (const state of states) {
    test(`is clean in the ${state.name} state`, async ({ page }) => {
      await gotoRendered(page, state.href)
      await settle(page)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      const serious = results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious'
      )
      expect(
        serious.map((violation) => `${violation.id}: ${violation.help}`),
        `axe violations in the ${state.name} state`
      ).toEqual([])
    })
  }

  test('uses valid definition lists throughout', async ({ page }) => {
    // The structural guard PR #55 exists because of: a `<dl>` whose children are anything
    // other than `<dt>`, `<dd>` or a wrapping `<div>` is invalid and axe does not always
    // catch it.
    await gotoRendered(page, `${ROUTE}?role=bdc&employee=EMP-00011`)
    const invalid = await page
      .locator('main dl')
      .evaluateAll((lists) =>
        lists.flatMap((list) =>
          [...list.children]
            .filter(
              (child) =>
                !['DT', 'DD', 'DIV', 'SCRIPT', 'TEMPLATE'].includes(child.tagName)
            )
            .map((child) => child.tagName)
        )
      )
    expect(invalid).toEqual([])

    // And inside a wrapping div, only dt/dd.
    const invalidInner = await page
      .locator('main dl > div')
      .evaluateAll((wrappers) =>
        wrappers.flatMap((wrapper) =>
          [...wrapper.children]
            .filter((child) => !['DT', 'DD'].includes(child.tagName))
            .map((child) => child.tagName)
        )
      )
    expect(invalidInner).toEqual([])
  })

  test('gives every visual mark a textual equivalent', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    // Every bar is decorative and the value beside it is text, which is what makes the
    // aria-hidden correct rather than a way of hiding information.
    const bars = page.locator('[data-testid="volume-bar"], [data-testid="mix-bar"]')
    const count = await bars.count()
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      await expect(bars.nth(index)).toHaveAttribute('aria-hidden', 'true')
    }
    const row = page.locator('li[data-employee]').first()
    expect(await row.innerText()).toMatch(/\d/)
  })
})

/* -------------------------------------------------------------------------- */
/* Responsive                                                                  */
/* -------------------------------------------------------------------------- */

test.describe('the comparison stays readable across the matrix', () => {
  for (const viewport of DASHBOARD_VIEWPORTS) {
    test(`has no horizontal overflow at ${String(viewport.width)}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await gotoRendered(page, `${ROUTE}?period=2025-12`)
      await settle(page)

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(
        overflow,
        `horizontal overflow at ${String(viewport.width)}`
      ).toBeLessThanOrEqual(1)

      // THE CONTEXT MUST NOT DISAPPEAR ON A PHONE. Tenure, the sample state and the mix are
      // part of what the figures mean, so they are not the first thing a narrow layout drops.
      const text = await lowerText(page)
      expect(text).toContain('tenure')
      expect(text).toContain('insufficient sample')
      expect(text).toContain('new and used mix')
    })
  }

  test('does not give one employee a whole phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoRendered(page, ROUTE)
    await settle(page)
    const heights = await page
      .locator('li[data-employee]')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
    expect(heights.length).toBeGreaterThan(1)
    for (const height of heights) {
      expect(height, 'an employee row fills a phone screen on its own').toBeLessThan(844)
    }
  })
})
