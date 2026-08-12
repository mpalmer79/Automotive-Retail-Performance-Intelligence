/**
 * `UX.2D.1` — five things the operating surface said that were not true.
 *
 * WHAT THIS SUITE IS FOR, AND WHY IT IS NOT `ux2d-controls.spec.ts`
 * ----------------------------------------------------------------
 * `UX.2D` rebuilt the control band and asserted it thoroughly: the phone ceiling,
 * the disclosure, the desktop band, chip removal, reset, the scope vocabulary, the
 * link builder and the persistence matrix. None of that is re-asserted here.
 *
 * This file covers a different class of defect, which that increment's measurements
 * could not see because every one of these is *correct-looking markup*. A control
 * that renders perfectly and cannot change a figure, a price that renders as a
 * smaller price, a rail that renders a true-looking sentence about a route it links
 * to, and a `<select>` that renders a real month that is not the month on screen.
 * The band can be compact and every one of these can still be wrong.
 *
 * Four of the five were found by reading the route's own declaration back against
 * what it rendered. The fifth was found by eye.
 */
import { expect, test, type Page } from '@playwright/test'

import { DASHBOARD_ROUTES, DEAL_JACKET_ROUTE } from './routes'
import { gotoRendered } from './helpers'

const OPERATING_ROUTES = DASHBOARD_ROUTES.filter((route) => route !== DEAL_JACKET_ROUTE)
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

/* -------------------------------------------------------------------------- */
/* 1. A route offers a control only where its own matrix says it means something */
/* -------------------------------------------------------------------------- */

test.describe('no route offers a filter it declares inapplicable', () => {
  for (const route of OPERATING_ROUTES) {
    test(`${route} offers no inert control`, async ({ page }) => {
      await page.setViewportSize(DESKTOP)
      await gotoRendered(page, route)
      /*
       * THE SIGNATURE OF THE DEFECT is a hint beginning "Not applied" underneath a
       * control the reader can operate. Measured on `main` at `88d1179` — after
       * `UX.2D` rebuilt the band — seven of the nine routes carried at least one.
       * `/dashboard/fi` carried two, both with their full option lists: a reader
       * could select `New`, submit, and watch every figure stay put. `UX.2D` moved
       * them inside a disclosure on a phone, which made the band compact and left
       * the controls inert.
       */
      const hints = await page
        .locator('main form[aria-label="Dashboard filters"] p')
        .allInnerTexts()
      for (const hint of hints) {
        expect(hint, `${route} hint`).not.toMatch(/^Not applied/i)
      }
    })

    test(`${route} offers no select that cannot be operated`, async ({ page }) => {
      await page.setViewportSize(DESKTOP)
      await gotoRendered(page, route)
      const selects = page.locator('main form[aria-label="Dashboard filters"] select')
      for (let i = 0; i < (await selects.count()); i += 1) {
        const name = await selects.nth(i).getAttribute('name')
        const options = await selects.nth(i).locator('option').count()
        /*
         * `/dashboard/employees` shipped a lead-source select holding only
         * "All lead sources" — on a route whose matrix declares `source`
         * PARTIAL, so the one parameter it says it applies could not be
         * selected from the form. The value was reachable only by typing it
         * into the URL.
         */
        expect(options, `${route} ${name ?? '?'} is operable`).toBeGreaterThan(1)
      }
    })
  }
})

/* -------------------------------------------------------------------------- */
/* 2. The period control names the period on screen                            */
/* -------------------------------------------------------------------------- */

test.describe('the period control names the period on screen', () => {
  for (const route of OPERATING_ROUTES) {
    test(`${route} selects the default it is showing`, async ({ page }) => {
      await page.setViewportSize(DESKTOP)
      await gotoRendered(page, route)
      const select = page.locator('main form select[name="period"]')
      if ((await select.count()) === 0) {
        // Actions declares `period` not-applicable; each of its rules carries its
        // own as-of scope. It is the only route allowed no period control.
        expect(route, 'only Actions may omit the period control').toBe(
          '/dashboard/actions'
        )
        return
      }
      /*
       * FOUND BY EYE, NOT BY ANY ASSERTION. Absent `period` means "the latest full
       * month the dataset holds" — a real member of `PeriodSelection` that
       * serializes to no parameter. A `<select>` whose value is `''` and whose
       * options do not contain `''` renders its FIRST option, so seven of the
       * eight routes carrying this control opened reading `July 2025` above a page
       * reporting December. The page was right and the control was lying about it,
       * which is worse than a control with no value: the reader has no reason to
       * distrust it.
       */
      const empty = select.locator('option[value=""]')
      await expect(empty, `${route} offers the default once`).toHaveCount(1)
      await expect(select, `${route} has the default selected`).toHaveValue('')
      await expect(empty).toHaveText(/default/i)
    })
  }

  test('a selected period is the one the control shows', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await gotoRendered(page, '/dashboard/sales-gross?period=2025-11')
    await expect(page.locator('main form select[name="period"]')).toHaveValue('2025-11')
    expect(await page.locator('main').innerText()).toContain('November 2025')
  })
})

/* -------------------------------------------------------------------------- */
/* 3. A money value is one token                                               */
/* -------------------------------------------------------------------------- */

/** Every visible `$…` run whose glyphs occupy more than one line box. */
async function brokenMoney(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const text = node.textContent ?? ''
      const parent = node.parentElement
      if (parent !== null && /\$[\d,]/.test(text)) {
        const style = getComputedStyle(parent)
        /*
         * `.sr-only` IS EXCLUDED, AND THE EXCLUSION IS THE POINT RATHER THAN A
         * LOOPHOLE. `globals.css` redefines `sr-only` to set
         * `white-space: normal` deliberately, and records why: Tailwind's
         * `nowrap` on a 1px box gives it an enormous scroll extent that Chromium
         * propagates up through every `overflow: visible` ancestor, and several
         * pages measured 523 px wide at a 375 px viewport before it changed. A
         * visually-hidden chart summary therefore wraps every few characters by
         * design, inside a box nobody sees. A screen reader is handed a STRING;
         * line boxes do not exist for it, and asserting against them there would
         * be asserting against the fix for a real overflow defect.
         */
        if (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          parent.closest('.sr-only') === null
        ) {
          for (const token of text.match(/\$[\d,.]+/g) ?? []) {
            const index = text.indexOf(token)
            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, index + token.length)
            const tops = new Set(
              [...range.getClientRects()]
                .filter((rect) => rect.width > 0)
                .map((rect) => Math.round(rect.top))
            )
            if (tops.size > 1) found.push(token)
          }
        }
      }
      node = walker.nextNode()
    }
    return found
  })
}

test.describe('money is never broken across two lines', () => {
  for (const viewport of [PHONE, DESKTOP]) {
    for (const route of [...OPERATING_ROUTES, DEAL_JACKET_ROUTE]) {
      test(`${route} keeps every money token whole at ${String(viewport.width)}`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport)
        await gotoRendered(page, route)
        /*
         * `body` carries `overflow-wrap: anywhere`, which is correct for the
         * 68-character schema-qualified identifiers this site puts inside prose
         * and wrong for a price in a 66 px table cell. Measured on `main` at
         * `88d1179`: the Deal Explorer broke 22 money values at 1440 × 900, and
         * 35 across five routes in total. `$38,127` rendered as `$38,12` above a
         * lone `7` — not clipped and not ellipsised, but silently rewritten into
         * a different, smaller-looking number. The `numeric` utility restores
         * normal breaking, under which UAX #14 keeps a currency run whole.
         */
        expect(await brokenMoney(page), `${route} at ${String(viewport.width)}`).toEqual(
          []
        )
      })
    }
  }
})

/* -------------------------------------------------------------------------- */
/* 4. The rail describes the application that exists                           */
/* -------------------------------------------------------------------------- */

test.describe('the navigation does not contradict itself', () => {
  test('names no section as unbuilt that it also links to', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await gotoRendered(page, '/')
    /*
     * `DASH.12` built the action queue and emptied `PLANNED_DASHBOARD_SECTIONS`.
     * The rail went on printing a hard-coded "Not built yet · Actions · DASH.12"
     * directly above a live Actions link, on every operating route, at every
     * viewport, in both the rail and the drawer, for four increments —
     * `UX.2D` included. `site.test.ts` guarded the DATA against outliving the
     * work it describes; nothing guarded the VIEW, because the view was not
     * reading the data.
     */
    const labels = await page.locator('nav[aria-label="Operating"] a').allInnerTexts()
    const shell = await page.locator('body').innerText()
    const index = shell.indexOf('Not built yet')
    if (index !== -1) {
      const claimed = shell.slice(index, index + 200)
      for (const label of labels) {
        expect(claimed, `${label} is linked and claimed unbuilt`).not.toContain(
          label.split('\n')[0] ?? label
        )
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 5. One methodology vocabulary                                               */
/* -------------------------------------------------------------------------- */

test.describe('the disclosure vocabulary is one verb and one form', () => {
  test('no operating route asks a question where its neighbours make a statement', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP)
    for (const route of OPERATING_ROUTES) {
      await gotoRendered(page, route)
      const summaries = await page.locator('main summary').allInnerTexts()
      for (const summary of summaries) {
        // The console said "calculated" in four places and "measured" in one for
        // the same act, and mixed a question form into a statement-form set.
        expect(summary, `${route}: ${summary}`).not.toMatch(
          /How is this calculated\?|is calculated$|What can I put in the URL\?/
        )
      }
    }
  })
})
