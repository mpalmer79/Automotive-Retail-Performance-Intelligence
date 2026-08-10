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

/*
 * The routes measured, and why the console appears twice.
 *
 * `/dashboard` is the first route on this site whose output depends on its query
 * string, so a single measurement would describe one filter state rather than the
 * route. The filtered entry is the more expensive of the two in principle - it is
 * server-rendered per request with a narrower store scope - and measuring both is
 * what makes "the payload does not grow with the filter" a checkable claim rather
 * than an assumption.
 *
 * `DASH.2-04` adds them and records the numbers in `portfolio/docs/PERFORMANCE.md`
 * as the console baseline. No budget is enforced from them yet: `DASH.13-02` sets
 * the budgets, from measurements rather than from invented figures.
 */
const ROUTES = [
  /*
   * The Executive surface is `/` since `UX.1`, and `/dashboard` is a permanent
   * redirect to it. Measuring the redirect would measure a hop rather than the
   * route; the two entries below are the surface at its default state and under a
   * filter, which is what makes "the payload does not grow with the filter" a
   * checkable claim rather than an assumption.
   */
  '/',
  '/?store=GSA-001&period=2025-11&condition=Used',
  '/dashboard/sales-gross',
  '/dashboard/sales-gross?store=GSA-001&period=2025-11&condition=New',
  '/dashboard/deals',
  '/dashboard/deals?period=2025-07-01..2025-12-31&sort=total_gross&dir=desc&page=12',
  // One Deal Jacket (`DASH.4`). The densest single document in the console: four
  // calculation blocks, a timeline, a checklist and a lineage disclosure, all server
  // components. Measured because the increment chose server rendering over
  // prerendering 650 documents, and a rendering decision that is not measured is a
  // preference.
  '/dashboard/deals/SLE-00000646',
  // The F&I page (`DASH.7`). Eight sections and five tables, all server components,
  // over four exported datasets of which two are partitioned. Measured filtered as
  // well as whole, because a category filter narrows the penetration table to one row
  // and the difference between the two payloads is the cheapest evidence that the
  // filter reaches the server rather than hiding rows in the browser.
  '/dashboard/fi',
  '/dashboard/fi?store=GSA-001&period=2025-11&product=gap',
  // The two `DASH.9` routes. Inventory appears three times because its cost is decided
  // by two independent things: how many store partitions the request opens, and whether
  // the drill-through panel is rendered. The unfiltered entry opens three partitions and
  // the store-filtered one opens a single partition, which is what makes "the partition
  // scoping reaches the server" checkable rather than asserted; the `?unit=` entry adds
  // one accounting partition and one panel on top of the whole table.
  '/dashboard/inventory',
  '/dashboard/inventory?store=GSA-001&period=2025-11',
  '/dashboard/inventory?unit=VEH-0000005',
  // Accounting reads two unchunked datasets and renders the comparison whole, so one
  // measurement describes the route. The filtered entry is still worth having: it is the
  // only console route where a filter narrows BOTH sides of a reconciliation at once.
  '/dashboard/accounting',
  '/dashboard/accounting?store=GSA-001&period=2025-11',
  '/dashboard/actions',
  '/dashboard/actions?severity=high&domain=inventory',
  // The leads and marketing route (`DASH.10`). Seven sections over five datasets, three
  // of them partitioned, all server components. Measured three ways because its cost is
  // decided by two independent things and one of them is new to the console: how many
  // store partitions the request opens, and whether a SOURCE filter is applied — which on
  // this route narrows the appointment measures as well as the lead ones, because
  // `vw_appointment_source_funnel` exists. The unfiltered entry opens nine partitions
  // across three datasets; the store-filtered one opens three.
  '/dashboard/leads-marketing',
  '/dashboard/leads-marketing?store=GSA-001&period=2025-11',
  '/dashboard/leads-marketing?source=LDS-007',
  // DASH.11. The default surface, the widest of the four role families, and the state that
  // suppresses most figures — because the interesting measurement is whether withholding a
  // ratio costs anything, and whether the BDC surface's source mix does.
  '/dashboard/employees',
  '/dashboard/employees?role=bdc',
  '/dashboard/employees?period=2025-12',
  '/dashboard/employees?role=finance&employee=EMP-00005',
  /*
   * The technical destination, at each of the eight states `UX.1` consolidated six
   * routes into. Measured per state rather than once: the point of rendering one
   * view per request is that a reader on the KPI catalogue does not pay for the
   * architecture explorer, and that is only a claim until the two are measured
   * separately.
   */
  '/technical',
  '/technical?view=architecture',
  '/technical?view=data-model',
  '/technical?view=kpis',
  '/technical?view=governance',
  '/technical?view=data-sources',
  '/technical?view=status',
  '/technical?view=product-vision',
  '/inventory',
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
  console.log('='.repeat(122))
  console.log(
    pad('Route', 62) +
      padStart('HTML', 10) +
      padStart('JS', 11) +
      padStart('CSS', 10) +
      padStart('Fonts', 10) +
      padStart('Total', 11)
  )
  console.log('-'.repeat(122))
  for (const row of [...rows].sort((a, b) => b.total - a.total)) {
    console.log(
      pad(row.route, 62) +
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
 * reason: no default stylesheet produces a blue gradient.
 *
 * It reads <html>, not <body>. The floating-canvas direction puts the field on
 * the root element so it covers the viewport when a document is shorter than one
 * screen and when the page is rubber-band scrolled past either end, which means
 * <body> is deliberately transparent - and a guard that kept checking <body>
 * would report every current build as stale.
 */
async function assertCurrentBuild(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  const field = await page.evaluate(
    () => getComputedStyle(document.documentElement).backgroundImage
  )
  if (!field.includes('linear-gradient')) {
    throw new Error(
      `${BASE} is serving a stale build: the root background-image is ${field}, not ` +
        'the blue field gradient. Restart the server against the current build ' +
        'before measuring.'
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
