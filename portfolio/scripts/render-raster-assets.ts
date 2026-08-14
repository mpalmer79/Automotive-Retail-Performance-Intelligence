#!/usr/bin/env tsx
/**
 * Render the raster assets that the SVG masters cannot substitute for.
 *
 * Two files, and each one exists for a specific reason rather than for
 * completeness:
 *
 *   public/favicon-32.png        A fallback for browsers that ignore the SVG
 *                                favicon.
 *   public/apple-touch-icon.png  iOS home-screen icon; SVG is not accepted.
 *
 * Everything else on the site - the marks, the diagrams, the motifs - is SVG and
 * is never rasterised.
 *
 * WHAT THIS SCRIPT NO LONGER RENDERS, AND MUST NOT START RENDERING AGAIN
 * ---------------------------------------------------------------------
 * The social card. It used to be the first target here: `brand/social-preview.svg`
 * rasterised to `public/social-preview.png` at 1200 x 630. ADR-0016 retired that
 * arrangement. The card is now a supplied raster committed directly at
 * `public/brand/social-preview.png`, there is no SVG master to render from, and the
 * old output path is deleted.
 *
 * Two failure modes are worth naming, because both are silent. Re-adding a social
 * target that writes `public/social-preview.png` would resurrect a retired asset at a
 * URL nothing references, and the site would carry two social cards that could
 * disagree. Re-adding one that writes `public/brand/social-preview.png` would
 * OVERWRITE the supplied card with whatever it rendered. `media.test.ts` asserts this
 * script names neither path, so neither can happen by accident.
 *
 * The renderer is the Chromium that Playwright already provides, so this adds no
 * dependency. The script is NOT part of `npm run build`: the outputs are
 * committed, deterministic for a given input, and rebuilding them on every CI
 * run would download a browser to produce three files that did not change.
 * Re-run it by hand after editing an SVG master:
 *
 *   npm run assets
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { resolveChromiumPath } from './chromium.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '..')
const PUBLIC = join(PORTFOLIO, 'public')

interface Target {
  readonly source: string
  readonly output: string
  readonly width: number
  readonly height: number
}

const TARGETS: readonly Target[] = [
  { source: 'favicon.svg', output: 'favicon-32.png', width: 32, height: 32 },
  { source: 'favicon.svg', output: 'apple-touch-icon.png', width: 180, height: 180 },
]

async function main(): Promise<void> {
  for (const target of TARGETS) {
    const sourcePath = join(PUBLIC, target.source)
    if (!existsSync(sourcePath)) {
      throw new Error(`Missing SVG master: public/${target.source}`)
    }
  }

  const executablePath = resolveChromiumPath()
  const browser = await chromium.launch(executablePath ? { executablePath } : {})
  try {
    for (const target of TARGETS) {
      const svg = readFileSync(join(PUBLIC, target.source), 'utf8')
      const page = await browser.newPage({
        viewport: { width: target.width, height: target.height },
        // 1 rather than 2: these are fixed-size assets whose dimensions are
        // dictated by the consumer (1200x630 for Open Graph, 180 for iOS), so a
        // device-scale factor would produce the wrong size, not a sharper one.
        deviceScaleFactor: 1,
      })
      // A zero-margin wrapper, so the screenshot is exactly the SVG's box with
      // no user-agent body margin bleeding a white edge into it.
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8">` +
          `<style>html,body{margin:0;padding:0;background:#05070b;}` +
          `svg{display:block;width:${String(target.width)}px;height:${String(target.height)}px;}</style>` +
          `</head><body>${svg}</body></html>`,
        { waitUntil: 'load' }
      )
      // The SVGs reference no webfont and no external resource, so `load` is
      // genuinely the finished state; there is nothing further to wait for.
      await page.screenshot({
        path: join(PUBLIC, target.output),
        type: 'png',
        omitBackground: false,
      })
      await page.close()
      console.log(
        `rendered public/${target.output}  (${String(target.width)}x${String(target.height)}) from public/${target.source}`
      )
    }
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
