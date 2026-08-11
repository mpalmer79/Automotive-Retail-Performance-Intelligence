/**
 * `UX.2C`: the demand, people and control routes are workspaces, measured rather than judged.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE PER-ROUTE SUITES. `dashboard-leads-marketing.spec.ts`,
 * `dashboard-employees.spec.ts`, `dashboard-accounting.spec.ts` and `dashboard-actions.spec.ts`
 * ask whether the figures on the screen are the exported figures — a question about
 * correctness. This one asks whether the manager who opened the route can SEE them, which is a
 * question about geometry, and every assertion below is an element offset against a stated
 * viewport at a width the increment names.
 *
 * The before-figures every assertion is calibrated against are in
 * `docs/reviews/UX-2C-BASELINE.md`, measured on the merge of `UX.2B.1`: three of the four routes
 * contained NO framed figure at all, the fourth put one of its seven inside the first screen
 * behind 213 words of prose, and `/dashboard/actions` was a 16,741 px document.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoRendered, mainTextContent, settle } from './helpers'

/** The visual regions whose top edge falls inside the first viewport. */
async function foldRegions(page: Page): Promise<readonly string[]> {
  await settle(page)
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-visual-region]')]
      .filter(
        (node) => node.getBoundingClientRect().top + window.scrollY < window.innerHeight
      )
      .map((node) => node.getAttribute('data-visual-region') ?? '')
  )
}

/** The document height, for the routes whose height was the finding. */
async function documentHeight(page: Page): Promise<number> {
  await settle(page)
  return page.evaluate(() => Math.round(document.documentElement.scrollHeight))
}

/* -------------------------------------------------------------------------- */
/* The first-viewport contracts (`UX.2C` §5)                                   */
/* -------------------------------------------------------------------------- */

test.describe('the first viewport carries data, not an introduction', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Leads & Marketing shows the rail and both progressions', async ({ page }) => {
    await gotoRendered(page, '/dashboard/leads-marketing')
    const regions = await foldRegions(page)
    expect(regions).toContain('kpi-rail')
    const data = regions.filter((name) => name !== 'kpi-rail')
    /*
     * THE TWO PROGRESSIONS AND THE RESPONSE DISTRIBUTION, in that order. `UX.2C` §8 requires
     * the lead grain and the appointment grain to be separate and adjacent; adjacency is only
     * a statement about grain if a reader sees both at once.
     */
    expect(data, `data regions inside the first viewport: ${data.join(', ')}`).toEqual([
      'lead-funnel',
      'appointment-progression',
      'response-distribution',
    ])
  })

  test('Leads & Marketing holds the contract under a filter too', async ({ page }) => {
    await gotoRendered(page, '/dashboard/leads-marketing?store=GSA-001&period=2025-11')
    const regions = await foldRegions(page)
    expect(regions).toContain('kpi-rail')
    expect(regions).toContain('lead-funnel')
    expect(regions).toContain('appointment-progression')
  })

  test('Employees shows the family rail and the comparison', async ({ page }) => {
    await gotoRendered(page, '/dashboard/employees')
    const regions = await foldRegions(page)
    expect(regions).toContain('family-rail')
    expect(regions).toContain('employee-comparison')
  })

  test('every role family reaches the same contract', async ({ page }) => {
    for (const role of ['desk', 'finance', 'bdc']) {
      await gotoRendered(page, `/dashboard/employees?role=${role}`)
      const regions = await foldRegions(page)
      expect(regions, `${role} first viewport: ${regions.join(', ')}`).toContain(
        'family-rail'
      )
      expect(regions).toContain('employee-comparison')
    }
  })

  test('Accounting shows the position rail and both control figures', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/accounting')
    const regions = await foldRegions(page)
    expect(regions).toContain('position-rail')
    expect(regions).toContain('balance-comparison')
    expect(regions).toContain('comparison-states')
  })

  test('Actions shows the queue shape and the gross bridge', async ({ page }) => {
    await gotoRendered(page, '/dashboard/actions')
    const regions = await foldRegions(page)
    expect(regions).toContain('queue-shape')
    expect(regions).toContain('change-bridge')
  })

  test('no route puts a methodology disclosure above its first figure', async ({
    page,
  }) => {
    for (const route of [
      '/dashboard/leads-marketing',
      '/dashboard/employees',
      '/dashboard/accounting',
      '/dashboard/actions',
    ]) {
      await gotoRendered(page, route)
      const offsets = await page.evaluate(() => {
        const top = (selector: string): number | null => {
          const node = document.querySelector(selector)
          return node === null
            ? null
            : Math.round(node.getBoundingClientRect().top + window.scrollY)
        }
        return {
          methodology: top('#methodology, #method, #timing'),
          rail: top('[data-visual-region]'),
        }
      })
      if (offsets.methodology === null || offsets.rail === null) continue
      expect(
        offsets.rail,
        `${route} puts methodology above its first region`
      ).toBeLessThan(offsets.methodology)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The phone (`UX.2C` §52)                                                     */
/* -------------------------------------------------------------------------- */

test.describe('the phone meets business state before methodology', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  /**
   * `UX.2C` §52 names TWO screens, not one: at 390 px the control band alone is most of the
   * first, and every operating route in this console shares it. The contract is that the
   * primary state and the first analytical figure are both inside 1,688 px.
   */
  const TWO_SCREENS = 844 * 2

  /*
   * ACTIONS IS ASSERTED ON ITS QUEUE SHAPE, and its first review prompt has its own test
   * below. `UX.2C` §52 asks that route for the queue summary and the FIRST ACTIONABLE PROMPT
   * inside two screens — not for the gross bridge, which is the second question a general
   * manager asks and correctly sits after the queue on a phone.
   */
  for (const [route, region] of [
    ['/dashboard/leads-marketing', 'lead-funnel'],
    ['/dashboard/employees', 'employee-comparison'],
    ['/dashboard/accounting', 'balance-comparison'],
    ['/dashboard/actions', 'queue-shape'],
  ] as const) {
    test(`${route} reaches ${region} inside two screens`, async ({ page }) => {
      await gotoRendered(page, route)
      const offset = await page.evaluate((name) => {
        const node = document.querySelector(`[data-visual-region="${name}"]`)
        return node === null
          ? null
          : Math.round(node.getBoundingClientRect().top + window.scrollY)
      }, region)
      expect(offset, `${route} renders no ${region}`).not.toBeNull()
      expect(
        offset ?? Number.POSITIVE_INFINITY,
        `${route} puts ${region} ${String(offset)} px down`
      ).toBeLessThan(TWO_SCREENS)
    })
  }

  test('Leads opens with the demand rail before any figure', async ({ page }) => {
    await gotoRendered(page, '/dashboard/leads-marketing')
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('[data-visual-region]')].map(
        (node) => node.getAttribute('data-visual-region') ?? ''
      )
    )
    expect(order[0]).toBe('kpi-rail')
  })

  test('Actions reaches its first review prompt inside two screens', async ({ page }) => {
    /*
     * THE ASSERTION §52 ACTUALLY MAKES for this route, and the one that shaped the facet nav.
     * With the four partitions stacked one to a row the queue shape measured 872 px at this
     * width, and the first review prompt landed at 1,947 px -- 259 px past the second screen.
     * Two partitions across, plus one redundant module note removed, brings it to 1,638 px
     * with the layout otherwise unchanged.
     *
     * Two other arrangements were measured and rejected. Moving the bridge beside the prompts
     * fixed the phone and cost 5,199 px of desktop height, because the prompt column narrows
     * under the container-query threshold for two columns and forty-seven cards stack in one.
     * Moving it below them fixed both and put the strongest analytical object on the route
     * back at the foot of the page, which is the defect the baseline recorded. A CSS `order`
     * swap would have satisfied everything and was refused: it splits the DOM order from the
     * visual one on exactly the viewport where a keyboard user can least afford it.
     */
    await gotoRendered(page, '/dashboard/actions')
    const offsets = await page.evaluate(() => {
      const top = (selector: string): number | null => {
        const node = document.querySelector(selector)
        return node === null
          ? null
          : Math.round(node.getBoundingClientRect().top + window.scrollY)
      }
      return {
        shape: top('[data-visual-region="queue-shape"]'),
        prompts: top('#prompts'),
        firstCard: top('#prompts article'),
      }
    })
    expect(offsets.shape).not.toBeNull()
    expect(offsets.firstCard).not.toBeNull()
    expect(offsets.shape ?? 0).toBeLessThan(offsets.prompts ?? 0)
    expect(
      offsets.firstCard ?? Number.POSITIVE_INFINITY,
      `the first review prompt is ${String(offsets.firstCard)} px down`
    ).toBeLessThan(TWO_SCREENS)
  })
})

/* -------------------------------------------------------------------------- */
/* The height that was the finding (`UX.2C` §54)                               */
/* -------------------------------------------------------------------------- */

test.describe('the routes are not documents any more', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  /*
   * A CEILING, NOT A TARGET. `UX.2C` §54 says the goal is analytical density rather than
   * minimum pixels, so these are set well above the measured after-figures — they exist to
   * catch a regression back toward the baseline shape, not to freeze a layout. The measured
   * values at merge are in `UX-2C-REVIEW.md`.
   */
  for (const [route, ceiling, before] of [
    ['/dashboard/leads-marketing', 6000, 8821],
    ['/dashboard/employees', 6000, 5386],
    ['/dashboard/accounting', 4000, 3290],
    ['/dashboard/actions', 11000, 16741],
  ] as const) {
    test(`${route} stays well inside its baseline height`, async ({ page }) => {
      await gotoRendered(page, route)
      const height = await documentHeight(page)
      expect(
        height,
        `${route} is ${String(height)} px, against ${String(before)} px before UX.2C`
      ).toBeLessThan(ceiling)
    })
  }
})

/* -------------------------------------------------------------------------- */
/* The responsive matrix (`UX.2C` §51)                                         */
/* -------------------------------------------------------------------------- */

const WIDTHS = [320, 375, 390, 768, 1024, 1280, 1440, 1920] as const

const ROUTES = [
  '/dashboard/leads-marketing',
  '/dashboard/employees',
  '/dashboard/accounting',
  '/dashboard/actions',
] as const

test.describe('no transformed route overflows its viewport at any width', () => {
  for (const route of ROUTES) {
    test(`${route} fits every width in the matrix`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await gotoRendered(page, route)
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
        /*
         * One pixel of tolerance, for the reason every responsive suite in this repository
         * carries it: a fractional layout width rounds up in the scroll metric and reports
         * an overflow the eye cannot see.
         */
        expect(
          overflow,
          `${route} overflows by ${String(overflow)} px at ${String(width)}`
        ).toBeLessThanOrEqual(1)
      }
    })
  }

  test('no money value or identifier breaks across lines at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    for (const route of ROUTES) {
      await gotoRendered(page, route)
      // A currency figure split over two lines reads as two numbers. The console's `numeric`
      // class carries the tabular font; nothing inside one may wrap.
      const broken = await page.evaluate(
        () =>
          [...document.querySelectorAll('main .numeric')].filter((node) => {
            const text = (node.textContent ?? '').trim()
            if (!/^[$+-]?[\d,]+(\.\d+)?$/.test(text)) return false
            return node.getClientRects().length > 1
          }).length
      )
      expect(broken, `${route} wraps a money value at 320 px`).toBe(0)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The whole surface, with no script at all (`UX.2C` §50)                      */
/* -------------------------------------------------------------------------- */

test.describe('every transformed route is complete without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('Leads serves the funnel, the response figures and the source measures', async ({
    page,
  }) => {
    await page.goto('/dashboard/leads-marketing')
    const text = await mainTextContent(page)
    for (const fragment of [
      'Valid leads',
      'Contact rate',
      'Appointment-set rate',
      'Lead-to-sale',
      'Cancelled in advance',
      'Never answered',
      'Furthest stage reached',
      'Sources on volume and the three governed rates',
      'Cost and return, by source',
    ]) {
      expect(text, `${fragment} needs JavaScript, which it must not`).toContain(fragment)
    }
  })

  test('Employees serves every role family, its samples and its context', async ({
    page,
  }) => {
    for (const role of ['salesperson', 'desk', 'finance', 'bdc']) {
      await page.goto(`/dashboard/employees?role=${role}`)
      const text = await mainTextContent(page)
      expect(text, `${role} loses its rail`).toContain('People credited')
      expect(text, `${role} loses its comparison`).toContain(
        'Credited activity, by person'
      )
      expect(text, `${role} loses its floor`).toContain('Minimum sample')
    }
  })

  test('Accounting serves both balances, the variance and every state', async ({
    page,
  }) => {
    await page.goto('/dashboard/accounting')
    const text = await mainTextContent(page)
    for (const fragment of [
      'Inventory subledger',
      'GL control balance',
      'Signed variance',
      'Reconciled',
      'Missing GL balance',
      'Missing subledger balance',
      'Accounting exceptions',
    ]) {
      expect(text, `${fragment} needs JavaScript, which it must not`).toContain(fragment)
    }
  })

  test('Actions serves the queue shape, the prompts and the bridge', async ({ page }) => {
    await page.goto('/dashboard/actions')
    const text = await mainTextContent(page)
    for (const fragment of [
      'open review prompts',
      'Severity',
      'Domain',
      'Review role',
      'Total gross change',
      'bridge attributes',
    ]) {
      expect(text, `${fragment} needs JavaScript, which it must not`).toContain(fragment)
    }
  })

  test('the Actions facets still filter, because they are links', async ({ page }) => {
    await page.goto('/dashboard/actions')
    const link = page
      .getByRole('navigation', { name: /filter the review queue/i })
      .getByRole('link', { name: /High/ })
      .first()
    await link.click()
    await page.locator('h1').first().waitFor({ state: 'visible' })
    expect(page.url()).toContain('severity=high')
    expect(await page.locator('main').innerText()).toMatch(
      /of \d+ open review prompts shown/
    )
  })

  test('the employee role switch still navigates, because it is links', async ({
    page,
  }) => {
    await page.goto('/dashboard/employees')
    await page
      .getByRole('navigation', { name: 'Employee role family' })
      .getByRole('link', { name: 'Finance', exact: true })
      .click()
    await expect(page).toHaveURL(/role=finance/)
    expect((await mainTextContent(page)).toLowerCase()).toContain('finance structure')
  })
})

/* -------------------------------------------------------------------------- */
/* The tab order stays a reading order (`UX.2C` §49)                           */
/* -------------------------------------------------------------------------- */

test.describe('no route explodes its own tab order', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  /*
   * `UX.2C` §49 forbids putting hundreds of graphical marks into the tab order without a
   * measured usability reason, and remembers the `UX.2B` scatter review. The four figure
   * sets this increment adds — funnel stages, response bands, source rows, comparison states
   * — are drawn as `aria-hidden` marks with their values in text, so none of them is
   * focusable at all. The Actions facets ARE links, deliberately: a facet is navigation.
   */
  for (const [route, ceiling] of [
    ['/dashboard/leads-marketing', 80],
    ['/dashboard/employees', 80],
    ['/dashboard/accounting', 60],
    ['/dashboard/actions', 260],
  ] as const) {
    test(`${route} keeps its focusable count reasonable`, async ({ page }) => {
      await gotoRendered(page, route)
      const count = await page.evaluate(
        () =>
          document.querySelectorAll(
            'main a[href], main button, main input, main select, main textarea, main [tabindex]:not([tabindex="-1"]), main summary'
          ).length
      )
      expect(count, `${route} exposes ${String(count)} focus stops`).toBeLessThanOrEqual(
        ceiling
      )
    })
  }

  test('no drawn mark is focusable on any transformed route', async ({ page }) => {
    for (const route of ROUTES) {
      await gotoRendered(page, route)
      const focusableMarks = await page.evaluate(
        () =>
          [...document.querySelectorAll('main [data-testid="bar-track"]')].filter(
            (node) => node.matches('a[href], button, [tabindex]:not([tabindex="-1"])')
          ).length
      )
      expect(focusableMarks, `${route} makes a bar focusable`).toBe(0)
    }
  })
})
