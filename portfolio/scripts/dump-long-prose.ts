#!/usr/bin/env tsx
/**
 * List every visible paragraph over a word threshold, per route.
 *
 * The companion to `measure-ux.ts`: that one says which routes are verbose, this
 * one says which sentences make them verbose. Editing from source alone gets this
 * wrong, because a paragraph rendered by a shared component appears on nine routes
 * and a paragraph inside a closed `<details>` appears on none.
 *
 *   ARPI_REVIEW_BASE_URL=http://localhost:3311 npx tsx scripts/dump-long-prose.ts 45
 */
import { chromium, type Browser } from '@playwright/test'

import { resolveChromiumPath } from './chromium.ts'

const BASE = process.env.ARPI_REVIEW_BASE_URL ?? 'http://localhost:3311'
const THRESHOLD = Number(process.argv[2] ?? '45')

const ROUTES: readonly string[] = [
  '/',
  '/dashboard/sales-gross',
  '/dashboard/deals',
  '/dashboard/inventory',
  '/dashboard/fi',
  '/dashboard/leads-marketing',
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
  '/dealerships/granite-subaru',
]

async function main() {
  const executablePath = resolveChromiumPath()
  const browser: Browser = await chromium.launch(
    executablePath === undefined ? {} : { executablePath }
  )
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'load' })
    await page.evaluate(async () => {
      window.scrollTo(0, document.documentElement.scrollHeight)
      await new Promise((resolve) => setTimeout(resolve, 200))
      window.scrollTo(0, 0)
    })
    const long = await page.evaluate((threshold: number) => {
      return [...document.querySelectorAll('p')]
        .filter((element) => {
          const style = getComputedStyle(element)
          if (style.display === 'none' || style.visibility === 'hidden') return false
          if (element.closest('[hidden]')) return false
          if (element.closest('[aria-hidden="true"]')) return false
          // See `measure-ux.ts`: a collapsed <details> hides its body with
          // content-visibility, which leaves a non-zero box behind.
          const details = element.closest('details')
          if (details !== null && !details.open && element.closest('summary') === null) {
            return false
          }
          const box = element.getBoundingClientRect()
          return box.width > 0 && box.height > 0
        })
        .map((element) => (element.textContent ?? '').trim())
        .filter(
          (text) =>
            text.split(/\s+/).filter((token) => token.length > 0).length > threshold
        )
    }, THRESHOLD)

    process.stdout.write(
      `\n## ${route} (${String(long.length)} over ${String(THRESHOLD)} words)\n`
    )
    for (const text of long) {
      const words = text.split(/\s+/).filter((token) => token.length > 0).length
      process.stdout.write(`\n- [${String(words)}w] ${text}\n`)
    }
  }

  await browser.close()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
