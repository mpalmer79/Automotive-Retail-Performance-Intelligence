#!/usr/bin/env node
/**
 * Report what a visitor actually downloads, per route.
 *
 * WHY IT DRIVES A BROWSER RATHER THAN READING A MANIFEST
 * -----------------------------------------------------
 * Two earlier versions of this script were wrong in instructive ways.
 *
 * The first read `.next/app-build-manifest.json`, the per-route chunk map. Next 16
 * builds with Turbopack, which does not emit that file, so the script reported
 * nothing.
 *
 * The second summed every `.js` file under `.next/static`. That number is
 * meaningless: it counts every route's chunks together, so no visitor ever pays it,
 * and it goes UP when code splitting improves - which is exactly backwards. It
 * reported a 38 kB "regression" for a change that removed a library from five
 * routes.
 *
 * This version loads each route in Chromium and sums the compressed transfer size
 * of the requests it makes. That is the figure a visitor pays, it is directly
 * comparable between runs, and it improves when code splitting improves.
 *
 * Informational: it prints a table and exits zero even when a route is over its
 * documented budget. The budgets in portfolio/docs/PERFORMANCE.md are reviewed by a
 * person; a hard CI threshold would be raised the first time it was inconvenient
 * rather than investigated.
 *
 * Usage, against a running production server:
 *
 *   npx next build && npx next start -p 3111
 *   ARPI_REVIEW_BASE_URL=http://localhost:3111 node scripts/report-bundle.mjs
 */
import { chromium, type Page } from '@playwright/test'

import { resolveChromiumPath } from './chromium.ts'

/** The resource buckets a route's transfer is broken into. */
type Bucket = 'document' | 'script' | 'stylesheet' | 'font' | 'image' | 'other'
type Transfer = Record<Bucket, number>
interface RouteReport extends Transfer {
  route: string
  total: number
}

const BASE = process.env.ARPI_REVIEW_BASE_URL ?? 'http://localhost:3111'

const ROUTES = [
  '/',
  '/architecture',
  '/data-model',
  '/kpis',
  '/governance',
  '/status',
  '/about',
  '/case-study',
]

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} kB`
const pad = (value: string | number, width: number): string => String(value).padEnd(width)
const padStart = (value: string | number, width: number): string =>
  String(value).padStart(width)

/**
 * Sum the compressed transfer of every request a route makes, by resource type.
 *
 * `blockPrefetch` is the difference between two useful numbers, and both are
 * reported because neither alone is honest:
 *
 *   false - what a visitor actually pays. The primary navigation links to all seven
 *           routes, and Next prefetches a `<Link>` whose target is in the viewport,
 *           so landing on any page pulls the whole site's client bundle. For an
 *           eight-page document site that is a deliberate trade: roughly 300 kB
 *           once, and every subsequent navigation is instant.
 *   true  - the route's OWN cost, which is what a change to that route moves. The
 *           first version of this report measured only the first figure, so a
 *           change that removed a library from five routes appeared to make things
 *           worse.
 */
async function measure(
  page: Page,
  route: string,
  blockPrefetch: boolean
): Promise<Transfer> {
  const byType: Transfer = {
    document: 0,
    script: 0,
    stylesheet: 0,
    font: 0,
    image: 0,
    other: 0,
  }

  if (blockPrefetch) {
    // App Router prefetches carry `Next-Router-Prefetch`, and the chunks they pull
    // arrive as ordinary script requests afterwards. Aborting the prefetch
    // navigation request stops the chunk fetches that follow it.
    await page.route('**/*', (routeHandler) => {
      const headers = routeHandler.request().headers()
      if (headers['next-router-prefetch'] === '1' || headers['rsc'] === '1') {
        void routeHandler.abort()
        return
      }
      void routeHandler.continue()
    })
  }

  page.on('response', (response) => {
    void response
      .request()
      .sizes()
      .then((sizes) => {
        const known: readonly string[] = [
          'document',
          'script',
          'stylesheet',
          'font',
          'image',
        ]
        const type = response.request().resourceType()
        const bucket: Bucket = known.includes(type) ? (type as Bucket) : 'other'
        byType[bucket] += sizes.responseBodySize + sizes.responseHeadersSize
      })
      .catch(() => {
        // A request that never completed contributes nothing.
      })
  })

  await page.goto(`${BASE}${route}`, { waitUntil: 'load' })
  // Let any deferred chunk arrive before measuring.
  await page.waitForTimeout(900)
  return byType
}

async function collect(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  blockPrefetch: boolean
): Promise<RouteReport[]> {
  const rows: RouteReport[] = []
  for (const route of ROUTES) {
    // A fresh context per route, so nothing is served from a warm cache and the
    // figure is a cold first load.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const byType = await measure(page, route, blockPrefetch)
    const total = Object.values(byType).reduce((sum, value) => sum + value, 0)
    rows.push({ route, ...byType, total })
    await context.close()
  }
  return rows
}

function printTable(title: string, rows: RouteReport[]): void {
  console.log('')
  console.log(title)
  console.log('='.repeat(78))
  console.log(
    pad('Route', 18) +
      padStart('HTML', 10) +
      padStart('JS', 11) +
      padStart('CSS', 10) +
      padStart('Fonts', 10) +
      padStart('Total', 11)
  )
  console.log('-'.repeat(78))
  for (const row of [...rows].sort((a, b) => b.total - a.total)) {
    console.log(
      pad(row.route, 18) +
        padStart(kb(row.document), 10) +
        padStart(kb(row.script), 11) +
        padStart(kb(row.stylesheet), 10) +
        padStart(kb(row.font), 10) +
        padStart(kb(row.total), 11)
    )
  }
}

/**
 * Refuse to report on a server that is not serving the current build.
 *
 * `next start` reads the build manifest once, at boot. Rebuild while it is running
 * and its content-hashed chunk names no longer exist, so it serves a document whose
 * stylesheet and scripts 404. Every byte figure this script then prints is a
 * measurement of a broken page - and because the numbers are still plausible, they
 * get believed.
 *
 * The check is the same one `capture-review-screenshots.ts` makes, for the same
 * reason: no default stylesheet produces the canvas token's colour.
 */
async function assertCurrentBuild(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  const background = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor
  )
  if (background !== 'rgb(5, 7, 11)') {
    throw new Error(
      `${BASE} is serving a stale build: body background is ${background}, not the ` +
        'canvas token. Restart the server against the current build before measuring.'
    )
  }
}

async function main(): Promise<void> {
  const executablePath = resolveChromiumPath()
  const browser = await chromium.launch(executablePath ? { executablePath } : {})

  try {
    const guard = await browser.newContext()
    await assertCurrentBuild(await guard.newPage())
    await guard.close()

    const withPrefetch = await collect(browser, false)
    const ownCost = await collect(browser, true)

    printTable('Route cost alone, cold load, compressed', ownCost)
    printTable(
      'What a visitor pays, cold load, compressed (navigation prefetch included)',
      withPrefetch
    )

    const sorted = [...withPrefetch].sort((a, b) => b.total - a.total)
    const heaviest = sorted.at(0)
    const lightest = sorted.at(-1)
    console.log('')
    if (heaviest && lightest) {
      console.log(`Heaviest as paid: ${heaviest.route} at ${kb(heaviest.total)}`)
      console.log(`Lightest as paid: ${lightest.route} at ${kb(lightest.total)}`)
    }
    console.log('')
    console.log(
      'The gap between the two tables is the primary navigation prefetching all'
    )
    console.log(
      'seven routes. For an eight-page document site that is a deliberate trade:'
    )
    console.log('roughly 300 kB once, and every subsequent navigation is instant.')
    console.log('')
    console.log('Budgets and their rationale: portfolio/docs/PERFORMANCE.md.')
    console.log('')
  } finally {
    await browser.close()
  }
}
main().catch((error: unknown) => {
  // Not a build failure. The report needs a running server, and its absence should
  // not turn a green pipeline red for a number nobody is gating on.
  console.log('')
  console.log('Bundle report skipped: could not reach a running server.')
  console.log(`  ${String(error).split('\n')[0]}`)
  console.log('  Start one with `npx next start -p 3111` and set ARPI_REVIEW_BASE_URL.')
  console.log('')
})
