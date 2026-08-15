#!/usr/bin/env tsx
/**
 * Measure the content density of every public route and route state.
 *
 * Not part of CI. This is the harness behind the before/after tables in the
 * `UX.3` review: it drives a real browser against a production build and reports
 * the geometry and the prose that a reader actually receives, because the same
 * questions answered by reading the source get the wrong answer whenever a
 * paragraph is conditional, collapsed, or rendered by a shared component.
 *
 * Usage, against a running production server:
 *
 *   npx next build && npx next start -p 3311
 *   ARPI_REVIEW_BASE_URL=http://localhost:3311 npx tsx scripts/measure-ux.ts out.json
 *
 * WHAT COUNTS AS PROSE, AND WHY IT IS NOT "ALL THE TEXT"
 * -----------------------------------------------------
 * `proseWords` counts words inside visible `<p>` elements only. A KPI value, a
 * table cell, a chip, an axis label and a heading are all text and none of them
 * is what this increment is reducing; counting them would report a data-dense
 * dashboard as more verbose than an essay. Paragraph text is the thing a reader
 * has to read rather than scan, so it is the thing measured.
 *
 * WHAT COUNTS AS A VISUAL
 * -----------------------
 * A framed visual region: an `<svg>`, `<img>`, `<figure>` or `<table>` at least
 * 120 px wide and 60 px tall. The floor is what excludes the icon set — a 16 px
 * lucide glyph is an `<svg>` and is not a visualization — while keeping sparklines,
 * bars, distribution rails, diagrams and screenshots. Nested matches are collapsed
 * to their outermost ancestor so one chart made of forty `<svg>` marks counts once.
 */
import { writeFileSync } from 'node:fs'

import { chromium, type Browser, type Page } from '@playwright/test'

import { resolveChromiumPath } from './chromium.ts'

const BASE = process.env.ARPI_REVIEW_BASE_URL ?? 'http://localhost:3311'
const OUT = process.argv[2] ?? 'ux-measurements.json'

/**
 * Every public route and every meaningful route state.
 *
 * The technical destination contributes eight entries because each `?view=`
 * renders a different document, and the operating routes contribute their
 * filtered states because a layout that only holds together on the default query
 * is a layout that has not been tested.
 */
const ROUTES: readonly string[] = [
  '/',
  '/?store=GC01',
  '/dashboard/sales-gross',
  '/dashboard/sales-gross?store=GS02&condition=used',
  '/dashboard/deals',
  '/dashboard/deals?condition=new&store=GC01',
  '/dashboard/inventory',
  '/dashboard/inventory?store=GP03',
  '/dashboard/fi',
  '/dashboard/leads-marketing',
  '/dashboard/leads-marketing?store=GC01',
  '/dashboard/employees',
  '/dashboard/accounting',
  '/dashboard/actions',
  '/technical',
  '/technical?view=architecture',
  '/technical?view=data-model',
  '/technical?view=kpis',
  '/technical?view=governance',
  '/technical?view=data-sources',
  '/technical?view=status',
  '/technical?view=product-vision',
  '/about',
  '/case-study',
  '/inventory',
  '/dealerships/granite-chevrolet',
  '/dealerships/granite-subaru',
  '/dealerships/granite-pre-owned',
]

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

interface Measurement {
  readonly route: string
  readonly viewport: string
  readonly height: number
  readonly proseWords: number
  readonly paragraphs: number
  readonly longestParagraph: number
  readonly paragraphsOver50: number
  readonly firstVisual: number | null
  readonly visualsInFirstViewport: number
  readonly visuals: number
  readonly overflow: number
}

async function measure(page: Page, viewportHeight: number) {
  /*
   * Everything inside this callback is written without a named inner function.
   * `tsx` compiles with esbuild's `keepNames`, which rewrites a named function
   * expression into a call to a `__name` helper that exists in the script's
   * module scope and not in the page's — so a factored-out `visible()` helper
   * throws `ReferenceError: __name is not defined` inside the browser.
   */
  return page.evaluate((fold: number) => {
    const paragraphs = [...document.querySelectorAll('p')]
      .filter((element) => {
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        if (element.closest('[hidden]')) return false
        if (element.closest('[aria-hidden="true"]')) return false
        /*
         * A paragraph inside a COLLAPSED `<details>` is not prose the reader
         * received. Chromium hides that content with `content-visibility` on the
         * details slot rather than with `display: none`, and it keeps reporting a
         * non-zero box for the descendants, so neither of the two checks above
         * catches it. Without this the metric counts every methodology disclosure
         * on the operating console as visible prose — which is the exact opposite
         * of what a disclosure does.
         */
        const details = element.closest('details')
        if (details !== null && !details.open && element.closest('summary') === null) {
          return false
        }
        const box = element.getBoundingClientRect()
        return box.width > 0 && box.height > 0
      })
      .map((element) => (element.textContent ?? '').trim())
      .filter((text) => text.length > 0)

    const words = paragraphs.map(
      (text) => text.split(/\s+/).filter((token) => token.length > 0).length
    )

    /*
     * `[data-visual-region]` is included because the operating console's geometry
     * is built from bordered divs rather than from `<svg>`: a KPI rail, a pace
     * bullet and a distribution stack are all real visualizations that the four
     * element selectors below would miss entirely. The console already marks
     * every module whose body is geometry with that attribute, for its own
     * viewport-contract tests, so the metric borrows the repository's own
     * definition rather than inventing a second one.
     */
    const candidates = [
      ...document.querySelectorAll('svg, img, figure, table, [data-visual-region]'),
    ].filter((element) => {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      if (element.closest('[hidden]')) return false
      const box = element.getBoundingClientRect()
      return box.width >= 120 && box.height >= 60
    })
    // Collapse nested matches: one chart is one visual, not forty marks.
    const outermost = candidates.filter(
      (element) =>
        !candidates.some((other) => other !== element && other.contains(element))
    )
    const tops = outermost
      .map((element) => Math.round(element.getBoundingClientRect().top + window.scrollY))
      .sort((a, b) => a - b)

    return {
      height: Math.round(document.documentElement.scrollHeight),
      proseWords: words.reduce((total, count) => total + count, 0),
      paragraphs: paragraphs.length,
      longestParagraph: words.length === 0 ? 0 : Math.max(...words),
      paragraphsOver50: words.filter((count) => count > 50).length,
      firstVisual: tops.length === 0 ? null : tops[0]!,
      visualsInFirstViewport: tops.filter((top) => top < fold).length,
      visuals: tops.length,
    }
  }, viewportHeight)
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    window.scrollTo(99_999, 0)
    const scrolled = Math.round(window.scrollX)
    window.scrollTo(0, 0)
    if (scrolled > 0) return scrolled

    const limit = document.documentElement.clientWidth
    let worst = 0
    for (const element of document.querySelectorAll('body *')) {
      const style = getComputedStyle(element)
      if (style.position === 'fixed' || style.position === 'absolute') continue
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (box.right <= limit + 1) continue
      if (element.closest('[aria-hidden="true"]')) continue

      let ancestor = element.parentElement
      let insideScroller = false
      while (ancestor && ancestor !== document.body) {
        const ancestorStyle = getComputedStyle(ancestor)
        if (ancestorStyle.overflowX === 'auto' || ancestorStyle.overflowX === 'scroll') {
          insideScroller = true
          break
        }
        ancestor = ancestor.parentElement
      }
      if (insideScroller) continue
      worst = Math.max(worst, Math.round(box.right - limit))
    }
    return worst
  })
}

async function main() {
  const executablePath = resolveChromiumPath()
  const browser: Browser = await chromium.launch(
    executablePath === undefined ? {} : { executablePath }
  )
  const results: Measurement[] = []

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()

    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'load' })
      // The motion boundary reveals sections on intersection, so a section below
      // the fold can measure zero-height until it has been scrolled past once.
      await page.evaluate(async () => {
        window.scrollTo(0, document.documentElement.scrollHeight)
        await new Promise((resolve) => setTimeout(resolve, 250))
        window.scrollTo(0, 0)
        await new Promise((resolve) => setTimeout(resolve, 250))
      })
      process.stderr.write(`  ${viewport.name} ${route}\n`)
      const measurement = await measure(page, viewport.height)
      const overflow = await horizontalOverflow(page)
      results.push({ route, viewport: viewport.name, ...measurement, overflow })
    }

    await context.close()
  }

  await browser.close()
  writeFileSync(OUT, JSON.stringify(results, null, 2))

  for (const viewport of VIEWPORTS) {
    const rows = results.filter((row) => row.viewport === viewport.name)
    process.stdout.write(`\n### ${viewport.name}\n`)
    process.stdout.write(
      '| Route | Height | Prose | Paras | Longest | >50w | 1st visual | Vis/fold | Visuals | Overflow |\n'
    )
    process.stdout.write(
      '| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: |\n'
    )
    for (const row of rows) {
      process.stdout.write(
        `| \`${row.route}\` | ${String(row.height)} | ${String(row.proseWords)} | ${String(row.paragraphs)} | ${String(row.longestParagraph)} | ${String(row.paragraphsOver50)} | ${row.firstVisual === null ? '—' : String(row.firstVisual)} | ${String(row.visualsInFirstViewport)} | ${String(row.visuals)} | ${String(row.overflow)} |\n`
      )
    }
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
