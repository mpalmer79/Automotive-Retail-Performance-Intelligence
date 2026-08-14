/**
 * Capture the Executive header at the three review widths, for visual inspection.
 *
 * A review aid, not a test. `tests/e2e/executive-profile-links.spec.ts` owns the
 * assertions; this writes PNGs a person looks at. Output goes to a directory passed on
 * the command line so nothing is written into the repository by accident.
 *
 * Usage:
 *   npx tsx scripts/capture-profile-links.ts <output-directory> [base-url]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from '@playwright/test'

import { resolveChromiumPath } from './chromium'

const SIZES = [
  { label: 'phone-390x844', width: 390, height: 844 },
  { label: 'tablet-768x1024', width: 768, height: 1024 },
  { label: 'desktop-1440x900', width: 1440, height: 900 },
] as const

async function main(): Promise<void> {
  const outputDir = process.argv[2]
  if (outputDir === undefined) {
    console.error(
      'usage: tsx scripts/capture-profile-links.ts <output-directory> [base-url]'
    )
    process.exit(2)
  }
  const baseUrl = process.argv[3] ?? 'http://127.0.0.1:3210'
  mkdirSync(outputDir, { recursive: true })

  const executablePath = resolveChromiumPath()
  const browser = await chromium.launch(executablePath ? { executablePath } : {})

  for (const size of SIZES) {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
    })
    await page.goto(baseUrl)
    await page.locator('h1').first().waitFor({ state: 'visible' })

    await page.screenshot({ path: join(outputDir, `viewport-${size.label}.png`) })

    const band = page.locator('[data-operating-band]')
    await band.screenshot({ path: join(outputDir, `band-${size.label}.png`) })

    // The evaluated body declares no function of its own: the loader this script runs
    // under injects a `__name` helper into every function it compiles, and that helper
    // does not exist in the page.
    const measured = await page.evaluate(() => {
      const wanted: Record<string, string> = {
        band: '[data-operating-band]',
        disclosure: '#trust',
        links: '[data-profile-links]',
        github: '[data-profile-links] a:nth-of-type(1)',
        linkedin: '[data-profile-links] a:nth-of-type(2)',
        controls: '[data-operating-controls]',
      }
      const measurements: Record<string, unknown> = {
        overflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
      for (const [name, selector] of Object.entries(wanted)) {
        const node = document.querySelector(selector)
        if (node === null) {
          measurements[name] = null
          continue
        }
        const { x, y, width, height } = node.getBoundingClientRect()
        measurements[name] = {
          left: Math.round(x),
          right: Math.round(x + width),
          top: Math.round(y),
          bottom: Math.round(y + height),
          width: Math.round(width),
          height: Math.round(height),
        }
      }
      return measurements
    })
    console.log(size.label, JSON.stringify(measured, null, 2))

    await page.close()
  }

  await browser.close()
}

void main()
