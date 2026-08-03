#!/usr/bin/env tsx
/**
 * Capture the adversarial visual-review screenshot set.
 *
 * Not part of CI and not committed. The outputs go to a gitignored directory and
 * are attached to the pull request as review evidence, per the decision recorded
 * in portfolio/docs/VISUAL_REVIEW.md: this project does not maintain committed
 * visual-regression baselines, because a baseline set nobody re-approves becomes
 * a rubber stamp, and a large binary set in the repository is a cost paid on
 * every clone forever.
 *
 * Usage, against a running production server:
 *
 *   npx next build && npx next start -p 3111
 *   ARPI_REVIEW_BASE_URL=http://localhost:3111 npm run review:screenshots
 */
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, type Browser, type Page } from '@playwright/test'

import { resolveChromiumPath } from './chromium.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../review-screenshots')
const BASE = process.env.ARPI_REVIEW_BASE_URL ?? 'http://localhost:3111'

/** Every route, at every viewport in the accessibility and responsive matrix. */
const ROUTES = [
  '/',
  '/dealerships/granite-chevrolet',
  '/dealerships/granite-subaru',
  '/dealerships/granite-pre-owned',
  '/inventory',
  '/architecture',
  '/data-model',
  '/inventory-operations',
  '/kpis',
  '/governance',
  '/status',
  '/about',
  '/case-study',
  '/ui-lab',
  '/this-route-does-not-exist',
] as const

const VIEWPORTS = [
  { name: '320', width: 320, height: 900 },
  { name: '375', width: 375, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 900 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1440', width: 1440, height: 1000 },
  { name: '1920', width: 1920, height: 1080 },
] as const

/**
 * Measure horizontal overflow.
 *
 * NOT `scrollWidth - clientWidth`. That was the first version of this check and
 * it produced false positives for two separate reasons: a visually-hidden 1px
 * box with `white-space: nowrap` has a wide scroll extent that Chromium
 * propagates up through `overflow: visible` ancestors, and a legitimate
 * `overflow-x: auto` region (the two explorer diagrams) reports its full content
 * width. Both are correct layouts.
 *
 * What matters for WCAG 1.4.10 is whether content ends up unreachable. This
 * checks the two things that actually mean that:
 *
 *   1. the viewport can genuinely be scrolled sideways, and
 *   2. a visible, in-flow element extends past the viewport's right edge without
 *      sitting inside a scroll container that would let the reader reach it.
 */
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

      // Decoration is not content. The blue field's motif is an SVG using
      // `preserveAspectRatio="xMidYMid slice"`, so at any aspect ratio but its
      // own it scales to COVER and its edges fall outside the viewport - the
      // same behaviour as a `background-size: cover` image, and the reason this
      // reported 80px at 1440px and 435px at 768px while the page was correct.
      //
      // Kept identical to the copy in tests/e2e/accessibility.spec.ts. The two
      // detectors are the same algorithm and have to stay in step: this one
      // drifted from that one by exactly this rule, and the result was a report
      // that contradicted a green suite.
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

async function capture(browser: Browser, reducedMotion: boolean): Promise<void> {
  const suffix = reducedMotion ? '-reduced-motion' : ''
  const problems: string[] = []

  for (const viewport of VIEWPORTS) {
    // The full matrix at every viewport is a lot of images to read. Narrow and
    // wide are the two that actually surface layout defects; the middle steps
    // are captured for the home page and the two explorers only.
    const routes =
      viewport.name === '375' || viewport.name === '1440'
        ? ROUTES
        : ([
            '/',
            '/dealerships/granite-subaru',
            '/inventory',
            '/architecture',
            '/kpis',
          ] as const)

    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    })

    for (const route of routes) {
      const page = await context.newPage()
      await page.goto(`${BASE}${route}`, { waitUntil: 'load' })
      // Settle the reveal animations and the counters before capturing.
      await page.waitForTimeout(reducedMotion ? 150 : 1400)

      const overflow = await horizontalOverflow(page)
      if (overflow > 0) {
        problems.push(
          `${route} at ${String(viewport.width)}px scrolls horizontally by ${String(overflow)}px`
        )
      }

      const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-')
      await page.screenshot({
        path: join(OUT, `${slug}-${viewport.name}${suffix}.png`),
        fullPage: true,
      })
      await page.close()
    }

    await context.close()
    console.log(
      `captured ${String(routes.length)} routes at ${String(viewport.width)}px${suffix}`
    )
  }

  // Zoom: emulated by shrinking the viewport to half while keeping the layout
  // width, which is how a 200% browser zoom presents to CSS.
  const zoomed = await browser.newContext({
    viewport: { width: 640, height: 512 },
    deviceScaleFactor: 1,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  })
  for (const route of ['/', '/kpis', '/status'] as const) {
    const page = await zoomed.newPage()
    await page.goto(`${BASE}${route}`, { waitUntil: 'load' })
    await page.waitForTimeout(reducedMotion ? 150 : 1200)
    const overflow = await horizontalOverflow(page)
    if (overflow > 0) {
      problems.push(`${route} at 200% zoom scrolls horizontally by ${String(overflow)}px`)
    }
    const slug = route === '/' ? 'home' : route.replace(/^\//, '')
    await page.screenshot({
      path: join(OUT, `${slug}-zoom200${suffix}.png`),
      fullPage: true,
    })
    await page.close()
  }
  await zoomed.close()
  console.log(`captured 3 routes at 200% zoom${suffix}`)

  if (problems.length > 0) {
    console.error('\nHORIZONTAL OVERFLOW DETECTED:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
  } else {
    console.log(`no horizontal overflow at any viewport${suffix}`)
  }
}

/** The mobile navigation drawer, open, which no route screenshot would show. */
async function captureMobileNav(browser: Browser): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/architecture`, { waitUntil: 'load' })
  await page.getByRole('button', { name: /open navigation menu/i }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'mobile-navigation-open-375.png') })
  await page.close()
  await context.close()
  console.log('captured the mobile navigation drawer, open')
}

/** A selected node in each explorer, which the default view does not show. */
async function captureInteractionStates(browser: Browser): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })

  const architecture = await context.newPage()
  await architecture.goto(`${BASE}/architecture`, { waitUntil: 'load' })
  await architecture
    .getByRole('option', { name: /reporting schema/i })
    .first()
    .click()
  await architecture.waitForTimeout(600)
  await architecture.screenshot({
    path: join(OUT, 'architecture-node-selected-1440.png'),
    fullPage: false,
  })
  await architecture.close()

  const dataModel = await context.newPage()
  await dataModel.goto(`${BASE}/data-model`, { waitUntil: 'load' })
  await dataModel.getByRole('option').first().click()
  await dataModel.waitForTimeout(600)
  await dataModel.screenshot({
    path: join(OUT, 'data-model-entity-selected-1440.png'),
    fullPage: false,
  })
  await dataModel.close()

  const kpis = await context.newPage()
  await kpis.goto(`${BASE}/kpis`, { waitUntil: 'load' })
  await kpis.getByLabel(/search by identifier/i).fill('inventory')
  await kpis.waitForTimeout(400)
  await kpis.screenshot({ path: join(OUT, 'kpis-filtered-1440.png'), fullPage: false })
  await kpis.getByLabel(/search by identifier/i).fill('zzzz-no-such-metric')
  await kpis.waitForTimeout(400)
  await kpis.screenshot({ path: join(OUT, 'kpis-empty-state-1440.png'), fullPage: false })
  await kpis.close()

  await context.close()
  console.log('captured explorer selection, KPI filter and KPI empty state')
}

/**
 * Refuse to review a page whose stylesheet did not load.
 *
 * `next start` reads the build manifest once, at boot. Rebuild while it is running
 * and its content-hashed chunk names no longer exist, so it serves a document whose
 * stylesheet 404s - and an unstyled page is still a page: it screenshots, it
 * measures, and every number it produces is garbage.
 *
 * That happened, and the resulting report claimed horizontal overflow on seven
 * route/viewport pairs. Every one was an artefact of a 21-byte stylesheet. It took
 * a DOM probe to establish that the layout was fine and the server was stale, which
 * is exactly the kind of time this check exists to save.
 *
 * The assertion is the cheapest one that cannot pass by accident: the root
 * element's computed background must be the blue field's gradient. No default
 * stylesheet produces a `linear-gradient`.
 *
 * It reads <html>, not <body>. The floating-canvas direction puts the field on
 * the root element so it covers the viewport when a document is shorter than one
 * screen, which means <body> is deliberately transparent - a guard that kept
 * checking <body> would reject every current build.
 *
 * A rule count is deliberately NOT used as a second signal. Tailwind v4 emits its
 * whole output inside four `@layer` blocks, so `document.styleSheets` reports a
 * top-level rule count in the dozens for a fully-loaded 63 kB stylesheet - the first
 * version of this guard used a threshold of 100 and rejected a perfectly good
 * server.
 */
async function assertStyled(browser: Browser): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  const field = await page.evaluate(
    () => getComputedStyle(document.documentElement).backgroundImage
  )
  await context.close()

  if (!field.includes('linear-gradient')) {
    throw new Error(
      [
        `The page at ${BASE} is unstyled: the root background-image computes to`,
        `${field}, not the blue field's linear-gradient.`,
        '',
        'This is almost always a server started before the current build. Restart it:',
        '',
        '  npx next build && npx next start -p 3111',
        '',
        'Measuring an unstyled page produces confident, wrong results - do not review',
        'the output of this run.',
      ].join('\n')
    )
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const executablePath = resolveChromiumPath()
  const browser = await chromium.launch(executablePath ? { executablePath } : {})
  try {
    await assertStyled(browser)
    await capture(browser, false)
    await capture(browser, true)
    await captureMobileNav(browser)
    await captureInteractionStates(browser)
  } finally {
    await browser.close()
  }
  console.log(`\nscreenshots written to portfolio/review-screenshots/`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
