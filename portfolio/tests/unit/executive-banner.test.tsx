/**
 * The Executive interface preview banner, and the regression it was written against.
 *
 * WHAT WENT WRONG, AND WHY EVERY EXISTING CHECK MISSED IT
 * ------------------------------------------------------
 * `arpi-executive-dashboard-hero-desktop.webp` was committed to `public/media` and rendered
 * by nothing. The file was present, the build was green, `media.test.ts` was green — and
 * `/` did not show the image, because `media.test.ts` verifies the captures the product
 * tour REFERENCES and an asset referenced by no component is invisible to it. "The file is
 * in the repository" and "a visitor sees it" are different claims, and only the first one
 * was being tested.
 *
 * So this file tests the second. The browser-level half of that claim — a laid-out,
 * decoded, correctly-proportioned box on the running route at three viewport widths — is in
 * `tests/e2e/executive-workspace.spec.ts`, because jsdom has no layout engine and would
 * report a cropped or overflowing banner as passing. What is asserted here is everything
 * that can be established without one: that the component renders the required `src`, that
 * the asset behind that `src` is committed at exactly the dimensions the component
 * declares, and that the page still wires the component in above a console that is still
 * whole.
 *
 * THE DIMENSION ASSERTION IS NOT DECORATION. The component declares 1654 x 951 to `next/
 * image` so the box is reserved before the bytes arrive. If the asset is ever re-exported
 * at another size and the constants are not updated, the reserved box is wrong and a 200 kB
 * hero shifts the entire console on load — silently, in production, and never in a test
 * that only checks the file exists.
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  EXECUTIVE_BANNER_ALT,
  EXECUTIVE_BANNER_CAPTION,
  EXECUTIVE_BANNER_HEIGHT,
  EXECUTIVE_BANNER_SRC,
  EXECUTIVE_BANNER_WIDTH,
  ExecutivePreviewBanner,
} from '@/components/dashboard/executive-preview-banner'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC_DIR = join(ROOT, 'public')

function source(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

/**
 * The intrinsic size of a lossy WebP, read from its key-frame header.
 *
 * Deliberately narrower than the reader in `media.test.ts`: this file checks ONE asset and
 * that asset is a `VP8 ` chunk, so an unhandled chunk type is a signal the file was
 * re-encoded rather than a case to support. It fails loudly instead of guessing.
 */
function webpDimensions(file: string): { width: number; height: number } {
  const buffer = readFileSync(file)
  expect(buffer.toString('ascii', 0, 4), `${file} is not a RIFF container`).toBe('RIFF')
  expect(buffer.toString('ascii', 8, 12), `${file} is not WebP`).toBe('WEBP')
  const chunk = buffer.toString('ascii', 12, 16)
  expect(chunk, `${file} is no longer a lossy WebP`).toBe('VP8 ')
  return {
    width: buffer.readUInt16LE(26) & 0x3fff,
    height: buffer.readUInt16LE(28) & 0x3fff,
  }
}

afterEach(cleanup)

/* -------------------------------------------------------------------------- */
/* The asset                                                                   */
/* -------------------------------------------------------------------------- */

describe('the banner asset', () => {
  const file = join(PUBLIC_DIR, EXECUTIVE_BANNER_SRC)

  it('is committed at the path the component asks for', () => {
    // `statSync` rather than `existsSync`: it fails with the resolved path in the message,
    // which is what a reader needs when the answer is "not where you expected".
    expect(() => statSync(file), `${EXECUTIVE_BANNER_SRC} is not committed`).not.toThrow()
  })

  it('is the required hero and not the product tour’s capture', () => {
    /*
     * The two files are different assets with different jobs, and confusing them is the
     * mistake this whole increment came out of. `executive-command-center.webp` is an
     * honest capture of the running console and belongs to the tour; this one is the
     * homepage's visual hero. Neither may stand in for the other.
     */
    expect(EXECUTIVE_BANNER_SRC).toBe('/media/arpi-executive-dashboard-hero-desktop.webp')
    expect(EXECUTIVE_BANNER_SRC).not.toContain('executive-command-center')
  })

  it('leaves the product tour’s capture in place', () => {
    expect(() =>
      statSync(join(PUBLIC_DIR, 'media/executive-command-center.webp'))
    ).not.toThrow()
  })

  it('measures exactly what the component reserves a box for', () => {
    expect(webpDimensions(file)).toEqual({
      width: EXECUTIVE_BANNER_WIDTH,
      height: EXECUTIVE_BANNER_HEIGHT,
    })
  })

  it('stays inside a budget a phone can afford for one above-the-fold image', () => {
    // ~197 kB today. 260 kB is headroom for a re-export and still a wall against one
    // written at quality 100, which on the route's LCP element is the thing that matters.
    expect(statSync(file).size).toBeLessThanOrEqual(260 * 1024)
  })
})

/* -------------------------------------------------------------------------- */
/* The component                                                               */
/* -------------------------------------------------------------------------- */

describe('the banner component', () => {
  it('renders an image whose source is the required asset', () => {
    render(<ExecutivePreviewBanner />)
    const image = screen.getByAltText(EXECUTIVE_BANNER_ALT)
    expect(image.tagName).toBe('IMG')
    // `next/image` may rewrite the attribute; the asset it resolves to may not change.
    expect(image.getAttribute('src')).toContain(EXECUTIVE_BANNER_SRC)
  })

  it('reserves the box, so a 200 kB hero shifts nothing beneath it', () => {
    render(<ExecutivePreviewBanner />)
    const image = screen.getByAltText(EXECUTIVE_BANNER_ALT)
    expect(image.getAttribute('width')).toBe(String(EXECUTIVE_BANNER_WIDTH))
    expect(image.getAttribute('height')).toBe(String(EXECUTIVE_BANNER_HEIGHT))
  })

  it('scales to the column instead of cropping to it', () => {
    /*
     * The responsive contract, asserted on the classes because jsdom cannot lay it out.
     * `object-cover` is the specific failure mode named in the increment: it would fill the
     * box at every width by CUTTING the interface off at the edges, which on an image whose
     * whole purpose is to show an interface is the one treatment that must never appear.
     */
    render(<ExecutivePreviewBanner />)
    const classes = screen.getByAltText(EXECUTIVE_BANNER_ALT).className
    expect(classes).toContain('w-full')
    expect(classes).toContain('h-auto')
    expect(classes).not.toContain('object-cover')
    expect(classes).not.toMatch(/\bmax-w-(prose|narrow|content)\b/)
  })

  it('says what the image is, once, in a subdued caption', () => {
    render(<ExecutivePreviewBanner />)
    expect(screen.getByText(EXECUTIVE_BANNER_CAPTION)).toBeInTheDocument()
    expect(EXECUTIVE_BANNER_CAPTION).toBe(
      'Executive interface preview. Live governed dashboard below.'
    )
    // One caption. The credibility note is a line, not a stack of disclaimers.
    expect(document.querySelectorAll('figcaption')).toHaveLength(1)
  })

  it('describes what is on screen rather than saying “screenshot of”', () => {
    expect(EXECUTIVE_BANNER_ALT.length).toBeGreaterThan(80)
    expect(EXECUTIVE_BANNER_ALT).not.toMatch(/screenshot|image of|picture of/i)
  })

  it('ships no client island', () => {
    // The wrapper stays a server-rendered part of the route. A `'use client'` here would
    // put a JavaScript boundary at the top of `/` for a static image.
    expect(source('src/components/dashboard/executive-preview-banner.tsx')).not.toContain(
      "'use client'"
    )
  })
})

/* -------------------------------------------------------------------------- */
/* The placement on the route                                                  */
/* -------------------------------------------------------------------------- */

describe('the homepage renders the banner above an intact console', () => {
  const page = source('src/app/(operating)/page.tsx')

  it('renders it, which is the whole point', () => {
    // The regression was the asset existing and being rendered by NOTHING. Import without
    // use would satisfy a naive grep for the filename; this asserts the element.
    expect(page).toContain('<ExecutivePreviewBanner />')
  })

  it('places it after the Executive header and before the workspace branch', () => {
    const header = page.indexOf('<OperatingPageHeader')
    const banner = page.indexOf('<ExecutivePreviewBanner />')
    const branch = page.indexOf('{overview.empty ? (')
    expect(header).toBeGreaterThan(0)
    expect(banner).toBeGreaterThan(header)
    expect(branch).toBeGreaterThan(banner)
  })

  it('renders it on an empty selection too', () => {
    /*
     * It is a picture of the product, not a view of the query, so it sits OUTSIDE the
     * `overview.empty` branch. A banner that disappeared when a filter matched no rows
     * would be a picture behaving like a figure.
     */
    const banner = page.indexOf('<ExecutivePreviewBanner />')
    const branch = page.indexOf('{overview.empty ? (')
    expect(banner).toBeLessThan(branch)
  })

  it('keeps every governed module the console had before it', () => {
    // The banner was added ABOVE the dashboard. Nothing was traded for it.
    for (const component of [
      '<KpiStrip',
      '<OperatingTrend',
      '<StoreComparisonSection',
      '<InventoryRisk',
      '<LeadFunnel',
      '<SalesAndGross',
      '<ReconciliationSection',
      '<AttentionSummary',
      '<TopActions',
      '<ChangeDriverBridge',
      '<TargetPaceSection',
      '<StoreScoreboard',
      '<FilterBar',
      '<TrustPanel',
      '<Workspace>',
    ]) {
      expect(page, `${component} is no longer rendered on /`).toContain(component)
    }
  })

  it('changed no calculation', () => {
    // The governed path is untouched: same builder, same filter parse, same action queue.
    expect(page).toContain('buildExecutiveOverview(parsed.filters, parsed.reset)')
    expect(page).toContain('buildAccountingSignal(parsed.filters)')
    expect(page).toContain('buildActionQueue(')
  })
})
