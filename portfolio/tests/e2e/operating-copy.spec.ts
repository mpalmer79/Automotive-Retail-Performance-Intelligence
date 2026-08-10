import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { DASHBOARD_ROUTES } from './routes'

/**
 * The operating-copy boundary: implementation language stays out of the
 * dealership's eye path.
 *
 * WHY THIS IS A BROWSER TEST AND NOT A SOURCE SCAN
 * -----------------------------------------------
 * The rule is about what a manager READS, and a source scan cannot tell the
 * difference between four things that look identical in a file:
 *
 *   1. `import { parseFilters } from '@/lib/dashboard/filters'`   an identifier
 *   2. `/* the semantic model reads reporting views only *​/`      a comment
 *   3. `<Text>Dataset v{version}</Text>` inside a closed `<details>`  methodology
 *   4. `<p>Dataset v{version}</p>` above the KPI rail               the defect
 *
 * Only the fourth is a violation, and only a rendered page can distinguish them.
 * So this reads VISIBLE text from a running build: `innerText` on `<main>`, which
 * excludes `display:none`, excludes `.sr-only`, and — critically — excludes the
 * contents of a collapsed `<details>`. That last exclusion is the whole design of
 * the rule rather than a loophole in it: `UX.1` did not delete the provenance, it
 * moved it behind a disclosure, and a guard that failed on disclosed methodology
 * would be a guard against honesty.
 *
 * THE OPEN-DISCLOSURE HALF OF THE ASSERTION
 * -----------------------------------------
 * A rule that only checks the collapsed state can be satisfied by deleting the
 * evidence. So the same routes are checked again with every `<details>` OPEN, and
 * there the terms must be PRESENT: the dataset version, the export as-of date and
 * the real-engine validation state have to be reachable on every operating route.
 * Together the two halves say "not first, and not gone".
 *
 * WHAT IS DELIBERATELY NOT RESTRICTED
 * -----------------------------------
 * GL, DMS, CRM, KPI, PVR, F&I, subledger, variance. These are dealership words. A
 * controller says "GL" and means the general ledger; banning it would make the
 * accounting surface talk around its own subject. The restricted list is
 * implementation vocabulary — languages, frameworks, storage engines, file
 * formats, build systems and internal artifact names — and nothing else.
 */

/**
 * Implementation vocabulary that may not appear in visible operating copy.
 *
 * Each entry is a whole-word or phrase match, case-insensitive. `SQL` is a word
 * boundary match on purpose: it must not fire on "NoSQL" inside a URL or on a
 * class name, and it must fire on the sentence "summed from the governed SQL
 * export".
 */
const RESTRICTED: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'PostgreSQL', pattern: /\bpostgre(?:s|sql)\b/i },
  { label: 'SQL', pattern: /\bsql\b/i },
  { label: 'Python', pattern: /\bpython\b/i },
  { label: 'TypeScript', pattern: /\btypescript\b/i },
  { label: 'JavaScript', pattern: /\bjavascript\b/i },
  { label: 'Next.js', pattern: /\bnext\.js\b/i },
  { label: 'React', pattern: /\breact\b/i },
  { label: 'TMDL', pattern: /\btmdl\b/i },
  { label: 'DAX', pattern: /\bdax\b/i },
  { label: 'Power BI', pattern: /\bpower\s?bi\b/i },
  { label: 'GitHub Actions', pattern: /\bgithub actions\b/i },
  { label: 'arpi_reporter', pattern: /\barpi_reporter\b/i },
  { label: 'contract fingerprint', pattern: /\bcontract fingerprint\b/i },
  { label: 'dataset version', pattern: /\bdataset v(?:ersion)?\b/i },
  { label: 'semantic model', pattern: /\bsemantic model\b/i },
  { label: 'reporting view', pattern: /\breporting views?\b/i },
  { label: 'source-controlled', pattern: /\bsource-controlled\b/i },
  { label: 'schema', pattern: /\bschemas?\b/i },
  { label: 'warehouse', pattern: /\bwarehouse\b/i },
  { label: 'continuous integration', pattern: /\bcontinuous integration\b/i },
]

/**
 * Terms that MUST remain reachable once the disclosures are opened.
 *
 * Fewer than the restricted list, because this half is asserting that the
 * provenance survived the move rather than enumerating everything that may be
 * disclosed.
 */
const DISCLOSED: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'dataset version', pattern: /\bdataset v/i },
  { label: 'real-engine validation state', pattern: /real-engine validation/i },
]

async function visibleMainText(page: Page): Promise<string> {
  return page.locator('main').innerText()
}

test.describe('operating routes speak dealership, not implementation', () => {
  for (const route of DASHBOARD_ROUTES) {
    test(`${route} carries no implementation vocabulary in its eye path`, async ({
      page,
    }) => {
      await page.goto(route)
      const text = await visibleMainText(page)

      const offenders = RESTRICTED.filter((entry) => entry.pattern.test(text)).map(
        (entry) => entry.label
      )
      expect(
        offenders,
        `${route} shows implementation vocabulary before a reader opens methodology`
      ).toEqual([])
    })
  }

  test('the rail and the shell carry none of it either', async ({ page }) => {
    // The rail is on every operating screen and is never collapsed, so a term
    // there is a term on nine routes at once.
    await page.goto('/')
    const rail = await page
      .getByRole('navigation', { name: 'Operating' })
      .first()
      .innerText()
    const offenders = RESTRICTED.filter((entry) => entry.pattern.test(rail)).map(
      (entry) => entry.label
    )
    expect(offenders, 'the operating rail carries implementation vocabulary').toEqual([])
  })
})

test.describe('the provenance moved rather than being deleted', () => {
  for (const route of DASHBOARD_ROUTES) {
    test(`${route} discloses its provenance one click away`, async ({ page }) => {
      await page.goto(route)
      // Open every disclosure on the page, which is what a reader does when they
      // want the methodology.
      await page.evaluate(() => {
        for (const element of document.querySelectorAll('details')) {
          element.open = true
        }
      })
      const text = await visibleMainText(page)

      const missing = DISCLOSED.filter((entry) => !entry.pattern.test(text)).map(
        (entry) => entry.label
      )
      expect(
        missing,
        `${route} no longer discloses its provenance at all, which is worse than showing it first`
      ).toEqual([])
    })
  }

  test('every operating route offers the methodology disclosure', async ({ page }) => {
    for (const route of DASHBOARD_ROUTES) {
      await page.goto(route)
      await expect(
        page
          .getByText(
            /Granite Auto Group is fictional\. Operating figures are synthetic\./i
          )
          .first(),
        route
      ).toBeVisible()
    }
  })

  test('the full synthetic statement is inside it on every operating route', async ({
    page,
  }) => {
    // `content-integrity.spec.ts` asserts the same statement on the reference
    // routes. This is the operating half: consolidating the prose did not weaken
    // the disclosure, it relocated it.
    for (const route of DASHBOARD_ROUTES) {
      await page.goto(route)
      await page.evaluate(() => {
        for (const element of document.querySelectorAll('details')) {
          element.open = true
        }
      })
      const text = await visibleMainText(page)
      expect(text, route).toMatch(/Every warehouse record in this project is synthetic/i)
    }
  })
})

test.describe('the technical destination is where the stack belongs', () => {
  test('names the stack plainly, so nothing was lost in the move', async ({ page }) => {
    await page.goto('/technical?view=architecture')
    const text = await page.locator('main').innerText()
    for (const term of [/PostgreSQL/i, /Power BI/i, /TMDL/i]) {
      expect(text, `the architecture view no longer names ${String(term)}`).toMatch(term)
    }
  })
})
