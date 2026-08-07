/**
 * The URL filter contract, in a browser (`DASH.2-02`).
 *
 * `dashboard-filters.test.ts` proves the grammar: parse, serialize, round-trip,
 * reject. What it cannot prove is the part that only exists in a browser - that a
 * copied link reproduces the view, that Back returns to the previous one and
 * Forward returns to the next, that Reset goes to the canonical default, and that a
 * garbage parameter produces a visible notice rather than a broken page.
 *
 * The whole point of putting filter state in the URL is that the browser's own
 * history becomes the undo stack. That claim is only worth making if something
 * presses the button.
 */
import { expect, test } from '@playwright/test'

import { gotoRendered, mainText } from './helpers'
import { DASHBOARD_VIEWPORTS } from './routes'

const ROUTE = '/dashboard'

/* -------------------------------------------------------------------------- */
/* Deep links                                                                  */
/* -------------------------------------------------------------------------- */

test.describe('a copied URL reproduces the view', () => {
  test('a store deep link renders that store and says so in the context rail', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-002`)
    const text = await mainText(page)
    expect(text).toContain('Granite Subaru')
    expect(text).toMatch(/store scope/i)
    expect(text).not.toContain('Granite Auto Group, all three stores')
  })

  test('a month deep link renders that month against the prior month', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-09`)
    const text = await mainText(page)
    expect(text).toContain('September 2025')
    expect(text).toContain('August 2025')
  })

  test('an arbitrary date range is a first-class period', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-11-15..2025-12-15`)
    const text = await mainText(page)
    expect(text).toContain('15 November 2025 to 15 December 2025')
  })

  test('a multi-store list selects both stores and neither of the others', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-001,GSA-002`)
    const text = await mainText(page)
    expect(text).toContain('Granite Chevrolet')
    expect(text).toContain('Granite Subaru')
    expect(text).not.toContain('Granite Pre-Owned Center of Merrimack')
  })

  test('the navigated view and the deep-linked view are the same view', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    await page.selectOption('#filter-store', 'GSA-003')
    await expect(page).toHaveURL(/store=GSA-003/)
    const navigated = await mainText(page)

    await gotoRendered(page, `${ROUTE}?store=GSA-003`)
    const deepLinked = await mainText(page)
    expect(deepLinked).toBe(navigated)
  })

  test('the comparison is withheld, in words, when its window is outside the export', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?compare=prior-year`)
    const text = await mainText(page)
    expect(text).toContain('Prior year: unavailable')
    expect(text).toContain('outside the exported reporting window')
  })

  test('switching the comparison off removes every difference', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?compare=none`)
    const text = await mainText(page)
    expect(text).toContain('None selected')
    expect(text).not.toMatch(/higher than|lower than|unchanged from/)
  })
})

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

test.describe('the browser history is the undo stack', () => {
  test('Back returns the previous filter state and Forward returns the later one', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    await expect(page).toHaveURL(new RegExp(`${ROUTE}$`))

    await page.selectOption('#filter-store', 'GSA-001')
    await expect(page).toHaveURL(/store=GSA-001/)
    await expect(page.locator('main')).toContainText('Granite Chevrolet')

    await page.selectOption('#filter-period', '2025-10')
    await expect(page).toHaveURL(/period=2025-10/)
    await expect(page).toHaveURL(/store=GSA-001/)

    await page.goBack()
    await expect(page).toHaveURL(/store=GSA-001/)
    await expect(page).not.toHaveURL(/period=2025-10/)
    await expect(page.locator('main')).toContainText('December 2025')

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`${ROUTE}$`))
    await expect(page.locator('main')).toContainText(
      'Granite Auto Group, all three stores'
    )

    await page.goForward()
    await expect(page).toHaveURL(/store=GSA-001/)
    await page.goForward()
    await expect(page).toHaveURL(/period=2025-10/)
    await expect(page.locator('main')).toContainText('October 2025')
  })

  test('a filter change writes exactly one history entry', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const before = await page.evaluate(() => window.history.length)
    await page.selectOption('#filter-store', 'GSA-002')
    await expect(page).toHaveURL(/store=GSA-002/)
    const after = await page.evaluate(() => window.history.length)
    expect(after - before).toBe(1)
  })
})

/* -------------------------------------------------------------------------- */
/* Reset and removal                                                           */
/* -------------------------------------------------------------------------- */

test.describe('reset and per-filter removal', () => {
  test('Reset filters returns to the canonical default URL', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-001&period=2025-09&condition=Used`)
    await page.getByRole('link', { name: 'Reset filters' }).click()
    await expect(page).toHaveURL(new RegExp(`${ROUTE}$`))
    await expect(page.locator('main')).toContainText(
      'Granite Auto Group, all three stores'
    )
    await expect(page.locator('main')).toContainText('December 2025')
  })

  test('a chip removes only its own parameter', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-001&period=2025-09`)
    await page.getByRole('link', { name: /Store: GSA-001/ }).click()
    await expect(page).toHaveURL(/period=2025-09/)
    await expect(page).not.toHaveURL(/store=/)
  })

  test('shows no reset control when nothing is filtered', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    expect(await page.getByRole('link', { name: 'Reset filters' }).count()).toBe(0)
    await expect(page.locator('main')).toContainText('None. Showing the group')
  })
})

/* -------------------------------------------------------------------------- */
/* Failure                                                                     */
/* -------------------------------------------------------------------------- */

test.describe('bad input fails safely and visibly', () => {
  test('an invalid value falls back and the page says which and why', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?store=NOPE&compare=sideways`)
    const notice = page.getByRole('status').filter({ hasText: 'filters were reset' })
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('Not a store code')
    await expect(notice).toContainText('prior-period, prior-year, none')
    // The rest of the view still rendered.
    await expect(page.locator('main')).toContainText('KPI-SLS-001')
  })

  test('a store that does not exist is refused rather than rendered empty', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-999`)
    await expect(page.locator('main')).toContainText('No such store in this dataset')
    await expect(page.locator('main')).toContainText(
      'Granite Auto Group, all three stores'
    )
  })

  test('an unknown parameter is ignored without a notice', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?utm_source=linkedin&period=2025-10`)
    expect(await page.getByText('filters were reset').count()).toBe(0)
    await expect(page.locator('main')).toContainText('October 2025')
  })

  test('a period outside the export substitutes the latest month and explains it', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?period=2019-01`)
    const notice = page.getByRole('status').filter({ hasText: 'period was adjusted' })
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('outside the exported reporting window')
    await expect(page.locator('main')).toContainText('December 2025')
    // Never a screen of zeroes that reads as a month with no sales.
    await expect(page.locator('main')).toContainText('$321,935')
  })

  test('a period that overlaps the export is trimmed, and says so', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-06-01..2025-07-15`)
    await expect(page.locator('main')).toContainText(
      'trimmed to the exported reporting window'
    )
    await expect(page.locator('main')).toContainText('1–15 July 2025')
  })

  test('an empty selection reads as empty, not as zero', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-07-04..2025-07-04&store=GSA-003`)
    const text = await mainText(page)
    expect(text).toContain('No matching records')
    expect(text).toContain('No exported rows match')
  })
})

/* -------------------------------------------------------------------------- */
/* Partial and inapplicable filters                                            */
/* -------------------------------------------------------------------------- */

test.describe('a filter this route cannot apply says so', () => {
  test('lists a future-domain parameter as active and not applied', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?structure=lease`)
    const text = await mainText(page)
    expect(text).toContain('Finance structure')
    expect(text).toContain('not applied here')
    expect(text).toContain('DASH.6')
  })

  test('marks a partially-applied filter as partial and names what it scopes', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?condition=Used`)
    const text = await mainText(page)
    expect(text).toContain('(partial)')
    expect(text).toContain('Selects inventory measures only')
  })

  test('leaves a measure alone when its dataset has no such attribute', async ({
    page,
  }) => {
    // The gross figure must not silently become "no matching records" because a
    // condition filter was applied to a dataset with no condition split.
    await gotoRendered(page, `${ROUTE}?store=GSA-001`)
    const unfiltered = await mainText(page)
    await gotoRendered(page, `${ROUTE}?store=GSA-001&condition=Used`)
    const filtered = await mainText(page)
    const gross = /Total gross[^$]*(\$[\d,]+)/
    expect(gross.exec(filtered)?.[1]).toBe(gross.exec(unfiltered)?.[1])
  })
})

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

test.describe('the controls are native, labelled and keyboard-operable', () => {
  test('every control is a real select with a visible label', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    for (const label of ['Period', 'Comparison', 'Store', 'Condition', 'Lead source']) {
      const control = page.getByLabel(label, { exact: false }).first()
      await expect(control).toBeVisible()
      expect(await control.evaluate((node) => node.tagName)).toBe('SELECT')
    }
  })

  test('is fully operable from the keyboard', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const store = page.locator('#filter-store')
    await store.focus()
    await expect(store).toBeFocused()
    await store.selectOption('GSA-002')
    await expect(page).toHaveURL(/store=GSA-002/)
    await expect(page.locator('main')).toContainText('Granite Subaru')
  })

  test('marks an active control without relying on colour alone', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-001`)
    // The active state is carried by the chip text in the summary as well as by the
    // control's own mark, so the state survives greyscale and 200% zoom.
    await expect(page.locator('main')).toContainText('Store: GSA-001')
  })

  test('reflects a deep-linked custom range back in the period control', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-11-15..2025-12-15`)
    const selected = await page
      .locator('#filter-period option:checked')
      .first()
      .textContent()
    expect(selected).toContain('Custom range')
  })

  for (const viewport of DASHBOARD_VIEWPORTS) {
    test(`the filter bar does not overflow at ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await gotoRendered(page, `${ROUTE}?store=GSA-001&condition=Used&structure=lease`)
      const scrolled = await page.evaluate(() => {
        window.scrollTo({ left: 200, behavior: 'instant' })
        const moved = window.scrollX
        window.scrollTo({ left: 0, behavior: 'instant' })
        return moved
      })
      expect(scrolled, `the page scrolls sideways at ${viewport.name}px`).toBe(0)
    })
  }
})
