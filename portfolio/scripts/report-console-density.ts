#!/usr/bin/env tsx
/**
 * Measure how much of `/dashboard` is prose and how much is instrument.
 *
 * WHY THIS EXISTS. The information-density claims in `docs/PERFORMANCE.md` §9.9 and
 * `../docs/dashboard/INFORMATION_ARCHITECTURE.md` §3 are numbers — "1,744 visible prose
 * words became 1,003", "the desktop page is 24.7% shorter" — and this repository's rule
 * is that a claim is derived from evidence rather than asserted. This is the instrument
 * that derived them, so the next person to change the console can re-run it rather than
 * take the table on trust.
 *
 * WHAT A "PROSE WORD" IS, AND WHY THE DEFINITION MATTERS. A word inside a RENDERED
 * paragraph of eight words or more. Three exclusions, each deliberate:
 *
 *   * `sr-only` content is not counted. It is not visible, and the whole point of moving
 *     a chart summary behind `sr-only` is that it stops competing for a sighted reader's
 *     attention while staying in the accessibility tree in full. Counting it would make
 *     an accessibility-preserving change look like no change at all.
 *   * A closed `<details>` is not counted. Same argument in the other direction: the
 *     scoreboard is still in the document and the e2e suite asserts that separately.
 *     What this measures is what a reader is asked to read on arrival.
 *   * A paragraph under eight words is not counted. Those are labels, units, values and
 *     KPI identifiers — the figures the console exists to publish. Counting them would
 *     penalise the page for carrying data, which is the opposite of the goal.
 *
 * `allVisibleWords` is reported beside it without any of those exclusions, so the two
 * numbers together say whether prose fell because it was cut or because something was
 * hidden.
 *
 * NOT PART OF CI. It needs a running production server and a browser, and its output is
 * a measurement rather than a pass or a fail. The `e2e` suite carries the assertion that
 * matters — a ceiling on visible prose words — and runs everywhere.
 *
 * Usage, against a running production server:
 *
 *   npx next build && npx next start -p 3111
 *   ARPI_REVIEW_BASE_URL=http://localhost:3111 npm run density
 *
 * To compare against a baseline, check the baseline commit out into a separate worktree,
 * build and serve it on another port, and run this twice.
 *
 * START THE SERVER AFTER THE BUILD, NOT BEFORE. `next start` reads the build manifest
 * once at boot, so rebuilding underneath a running server leaves it serving HTML that
 * references chunk hashes it no longer has. The stylesheet 404s, the page renders as one
 * unstyled column at every width, and the report comes back with the desktop and mobile
 * heights nearly equal — which is the symptom worth recognising, because nothing errors
 * and the numbers look like a plausible measurement of something.
 */
import { chromium, type Browser } from '@playwright/test'

import { resolveChromiumPath } from './chromium.ts'

const BASE = process.env.ARPI_REVIEW_BASE_URL ?? 'http://localhost:3111'
const ROUTE = process.env.ARPI_DENSITY_ROUTE ?? '/dashboard'

/** The two viewports the visual review is conducted at. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

interface Density {
  readonly proseWords: number
  readonly proseParagraphs: number
  readonly allVisibleWords: number
  readonly regionHeadings: number
  readonly subHeadings: number
  readonly figures: number
  readonly tables: number
  readonly details: number
  readonly openDetails: number
  readonly pageHeight: number
}

async function measure(
  browser: Browser,
  viewport: (typeof VIEWPORTS)[number]
): Promise<Density> {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
  })
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle' })

  // Walk the whole page so every viewport-triggered reveal has fired. `instant`,
  // because the site enables smooth scrolling and a smooth scroll does not arrive
  // within the loop's step delay — the walk would silently never reach the bottom.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' })
      await new Promise((resolve) => setTimeout(resolve, 70))
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
    await new Promise((resolve) => setTimeout(resolve, 300))
  })

  const density = await page.evaluate(() => {
    const main = document.querySelector('main')
    if (main === null) {
      throw new Error('the route rendered no <main>')
    }

    let proseWords = 0
    let proseParagraphs = 0
    for (const element of main.querySelectorAll('p')) {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      if (element.closest('.sr-only') !== null) continue
      const details = element.closest('details')
      if (details !== null && !details.open) continue
      const words = (element.innerText || '').trim().split(/\s+/).filter(Boolean).length
      if (words < 8) continue
      proseWords += words
      proseParagraphs += 1
    }

    const visible = (main.innerText || '').replace(/\s+/g, ' ').trim()
    return {
      proseWords,
      proseParagraphs,
      allVisibleWords: visible.split(/\s+/).filter(Boolean).length,
      regionHeadings: main.querySelectorAll('h2').length,
      subHeadings: main.querySelectorAll('h3').length,
      figures: main.querySelectorAll('figure').length,
      tables: main.querySelectorAll('table').length,
      details: main.querySelectorAll('details').length,
      openDetails: [...main.querySelectorAll('details')].filter((node) => node.open)
        .length,
      pageHeight: document.documentElement.scrollHeight,
    }
  })

  await page.close()
  return density
}

async function main(): Promise<void> {
  let browser: Browser
  try {
    browser = await chromium.launch({ executablePath: resolveChromiumPath() })
  } catch (error) {
    console.error(
      `Density report skipped: could not launch a browser.\n  ${String(error)}`
    )
    process.exitCode = 0
    return
  }

  try {
    console.log(`\n${ROUTE} at ${BASE}\n`)
    const header = [
      'Viewport',
      'Prose words',
      'Paragraphs',
      'All words',
      'h2',
      'h3',
      'Figures',
      'Tables',
      'Details',
      'Height',
    ]
    console.log(header.map((cell) => cell.padEnd(12)).join(''))
    console.log('-'.repeat(header.length * 12))
    for (const viewport of VIEWPORTS) {
      const density = await measure(browser, viewport)
      console.log(
        [
          `${viewport.name} ${String(viewport.width)}`,
          String(density.proseWords),
          String(density.proseParagraphs),
          String(density.allVisibleWords),
          String(density.regionHeadings),
          String(density.subHeadings),
          String(density.figures),
          String(density.tables),
          `${String(density.openDetails)}/${String(density.details)}`,
          `${String(density.pageHeight)} px`,
        ]
          .map((cell) => cell.padEnd(12))
          .join('')
      )
    }
    console.log(
      '\nA "prose word" is a word inside a rendered paragraph of eight words or more,' +
        '\nexcluding sr-only content and closed disclosures. See the header of this' +
        '\nscript for why each exclusion is there, and PERFORMANCE.md section 9.9 for' +
        '\nthe figures this produced.\n'
    )
  } catch (error) {
    console.error(`Density report failed.\n  ${String(error)}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

void main().catch((error: unknown) => {
  console.error(`Density report failed.\n  ${String(error)}`)
  process.exitCode = 1
})
