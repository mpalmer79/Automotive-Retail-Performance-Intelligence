/**
 * The committed media, and the claims made about it.
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * This site publishes four product images and one social card, and it makes a
 * strong claim about all five: that they are straight captures of routes of this
 * application, or a card that states only what the repository can prove. A
 * reader cannot check that claim. These tests are the check.
 *
 * They cannot verify that a WebP is a photograph of the right page - that needs
 * eyes, and `scripts/capture-product-media.ts` plus a review of the diff is how
 * it is done. What they CAN verify is everything that goes wrong silently:
 *
 *   - a capture referenced by the tour that is not in the repository, which ships
 *     a broken frame,
 *   - a capture whose real pixel dimensions have drifted from the ones the tour
 *     declares, which reserves the wrong box and shifts the layout on load,
 *   - a capture that has quietly become large enough to matter on a phone,
 *   - a raster asset that no longer matches the SVG it is rendered from,
 *   - a social card that has started asserting a business result.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { TOUR_STEPS } from '@/components/sections/product-tour'
import { formatMetric } from '@/components/dashboard/metric'
import { dashboardStores } from '@/lib/dashboard/data'
import { buildExecutiveOverview } from '@/lib/dashboard/executive'
import { parseFilters } from '@/lib/dashboard/filters'
import { OG_IMAGE_HEIGHT, OG_IMAGE_PATH, OG_IMAGE_WIDTH } from '@/lib/metadata'

const PUBLIC_DIR = join(process.cwd(), 'public')

/**
 * The largest a product capture may be, in bytes.
 *
 * The four currently sit between 54 and 64 kB. 96 kB is headroom for a re-take
 * at a slightly different crop and a wall for one accidentally written at
 * quality 100 or without the resize.
 */
const CAPTURE_MAX_BYTES = 96 * 1024

/**
 * Read the intrinsic dimensions of a WebP from its header.
 *
 * A dependency is not needed for this and would be the wrong trade: `sharp` is a
 * dev dependency of the capture script, and importing a native image library
 * into the unit suite to read two integers slows every run.
 *
 * Layout: bytes 0-3 "RIFF", 8-11 "WEBP", then a chunk header at 12. The three
 * chunk kinds this project's encoder can emit are handled; anything else fails
 * loudly rather than returning a plausible wrong answer.
 */
function webpDimensions(file: string): { width: number; height: number } {
  const buffer = readFileSync(file)
  expect(buffer.toString('ascii', 0, 4), `${file} is not a RIFF container`).toBe('RIFF')
  expect(buffer.toString('ascii', 8, 12), `${file} is not WebP`).toBe('WEBP')

  const chunk = buffer.toString('ascii', 12, 16)

  if (chunk === 'VP8X') {
    // Extended format: 24-bit little-endian canvas size minus one, at byte 24.
    const width = 1 + (buffer.readUIntLE(24, 3) & 0xffffff)
    const height = 1 + (buffer.readUIntLE(27, 3) & 0xffffff)
    return { width, height }
  }

  if (chunk === 'VP8L') {
    // Lossless: 14 bits of width then 14 of height, packed from byte 21.
    const bits = buffer.readUInt32LE(21)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
  }

  if (chunk === 'VP8 ') {
    // Lossy: the key frame header carries both as 14-bit values at byte 26.
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }

  throw new Error(`${file} has an unhandled WebP chunk type: ${chunk}`)
}

/* -------------------------------------------------------------------------- */
/* The product tour captures                                                   */
/* -------------------------------------------------------------------------- */

describe('the product tour captures', () => {
  it('shows four steps, one per explorable route', () => {
    expect(TOUR_STEPS).toHaveLength(4)
    // Three of the four now point at a technical VIEW rather than at a route of
    // its own: `UX.1` consolidated the six documentation routes into `/technical`,
    // and a tour step that pointed at a redirect would send a reader through a hop
    // to reach the thing it is showing them.
    expect(TOUR_STEPS.map((step) => step.href)).toEqual([
      '/inventory',
      '/technical?view=architecture',
      '/technical?view=data-model',
      '/technical?view=kpis',
    ])
  })

  for (const step of TOUR_STEPS) {
    describe(step.id, () => {
      const file = join(PUBLIC_DIR, step.image.src)

      it('is committed to the repository', () => {
        expect(
          existsSync(file),
          `${step.image.src} is referenced but not committed`
        ).toBe(true)
      })

      it('is a modern format', () => {
        expect(step.image.src).toMatch(/\.(webp|avif)$/)
      })

      it('matches the dimensions the tour declares', () => {
        // The whole point: a declared box that disagrees with the file is a
        // layout shift the moment the bytes arrive.
        expect(webpDimensions(file)).toEqual({
          width: step.image.width,
          height: step.image.height,
        })
      })

      it('stays inside the per-capture byte budget', () => {
        expect(statSync(file).size).toBeLessThanOrEqual(CAPTURE_MAX_BYTES)
      })

      it('describes what is on screen rather than saying "screenshot of"', () => {
        expect(step.image.alt.length).toBeGreaterThan(80)
        expect(step.image.alt).not.toMatch(/screenshot|image of|picture of/i)
        // And it does not simply repeat the visible heading beside it, which a
        // screen-reader user would then hear twice.
        expect(step.image.alt).not.toBe(step.title)
      })

      it('carries a provenance label and exactly one way in', () => {
        expect(step.provenance).toBe('capture')
        expect(step.provenanceNote.length).toBeGreaterThan(0)
        expect(step.cta.length).toBeGreaterThan(0)
      })

      it('claims no business result', () => {
        const prose = `${step.summary} ${step.insight ?? ''} ${step.provenanceNote}`
        for (const forbidden of [
          /\bgross profit of\b/i,
          /\bincreased? (sales|gross|revenue|profit|turn)\b/i,
          /\bimproved? (sales|gross|revenue|profit|turn)\b/i,
          /\breduced? (days supply|aging|aged inventory)\b/i,
          /\b\d+% (increase|improvement|lift|growth)\b/i,
          /\bROI\b/,
        ]) {
          expect(prose, `${step.id} asserts a business result`).not.toMatch(forbidden)
        }
      })
    })
  }
})

/* -------------------------------------------------------------------------- */
/* The social card                                                             */
/* -------------------------------------------------------------------------- */

describe('the social card', () => {
  const png = join(PUBLIC_DIR, OG_IMAGE_PATH)
  const svg = join(PUBLIC_DIR, 'brand/social-preview.svg')

  it('is committed at the declared path', () => {
    expect(existsSync(png)).toBe(true)
  })

  it('is the size every social platform crops from', () => {
    // 1200x630 is what LinkedIn, X and Slack all expect. A card at another
    // ratio is cropped by the platform, and the crop is not this project's
    // choice.
    expect(OG_IMAGE_WIDTH).toBe(1200)
    expect(OG_IMAGE_HEIGHT).toBe(630)

    const buffer = readFileSync(png)
    expect(buffer.toString('ascii', 12, 16), 'not a PNG IHDR').toBe('IHDR')
    expect(buffer.readUInt32BE(16)).toBe(OG_IMAGE_WIDTH)
    expect(buffer.readUInt32BE(20)).toBe(OG_IMAGE_HEIGHT)
  })

  it('names the author and states the group is fictional', () => {
    const source = readFileSync(svg, 'utf8')
    expect(source).toContain('Michael Palmer')
    expect(source).toMatch(/fictional/i)
    expect(source).toMatch(/synthetic/i)
  })

  /*
   * WHAT REPLACED "THE CARD SHOWS NO VALUE", AND WHY.
   *
   * Until the `DASH.13` closeout this block asserted that the card contained no
   * currency amount, no percentage and no unit count. That was the right rule for
   * the card it was written against: that card drew a wireframe of `/inventory`
   * with empty cells, and any figure in an empty wireframe would have been
   * invented.
   *
   * The replacement card carries four KPI values and a six-month trend, and the
   * rule that makes THAT honest is not "no numbers" — it is "every number is the
   * product's own output, and can be recomputed". So the assertion is now the
   * stronger one: the figures printed on the card are compared against
   * `buildExecutiveOverview()`, the same governed path that renders `/`.
   *
   * This also closes a failure mode the old rule could not see. A card with
   * hand-typed figures passes "no invented values" the day it is drawn and goes
   * silently stale the first time the synthetic dataset is regenerated. This test
   * fails on that day instead.
   */
  describe('every figure on it is the product’s own output', () => {
    const source = readFileSync(svg, 'utf8')
    const drawnText = [...source.matchAll(/>([^<]+)</g)]
      .map((match) => match[1]?.trim() ?? '')
      .join(' ')

    const parsed = parseFilters({})
    const overview = buildExecutiveOverview(parsed.filters, parsed.reset)
    const valueOf = (label: string): string => {
      const card = overview.cards.find((candidate) => candidate.label === label)
      expect(card, `the page no longer renders a "${label}" card`).toBeDefined()
      return String(formatMetric(card!.metric.selector, card!.metric.current))
    }

    it.each([
      ['Retail units'],
      ['Total gross'],
      ['Total gross per retail unit'],
      ['Aged inventory percentage'],
      ['Inventory investment'],
    ])('draws the live value of %s', (label) => {
      const rendered = valueOf(label)
      expect(
        drawnText,
        `the card does not show ${rendered}, which is what the Executive Command ` +
          `Center currently computes for "${label}". Regenerate the card from the ` +
          'current dataset rather than editing the number: public/brand/social-preview.svg ' +
          'is the master and its header comment records the provenance of every figure.'
      ).toContain(rendered)
    })

    it('draws the period those figures were read over', () => {
      // A figure without its period is not checkable, which is the whole reason
      // the values are allowed on the card at all.
      expect(drawnText.toUpperCase()).toContain(
        overview.periodContext.period.label.toUpperCase()
      )
    })

    it('keeps the synthetic disclosure in the same visual weight as the figures', () => {
      // The disclosure is not small print. It gets a bordered panel and an accent
      // colour, and this asserts the panel is still there rather than trusting
      // that the word "synthetic" appears somewhere in a comment.
      const body = source.slice(source.indexOf('</defs>'))
      expect(body).toMatch(/Synthetic data/)
      expect(body).toMatch(/Granite Auto Group is fictional/)
    })

    it('names no store and no employee', () => {
      // Fairness freeze, applied to the one surface whose context cannot travel
      // with the picture. In the product a store comparison carries its
      // disclosures; cropped into a social card it reads as a league table.
      for (const store of dashboardStores) {
        for (const naming of [store.name, store.shortName]) {
          expect(drawnText, `the card names the store "${naming}"`).not.toContain(naming)
        }
      }
      expect(drawnText).not.toMatch(/\bsalesperson|\badvisor\b|\bemployee of\b/i)
    })
  })

  it('stays small enough to be fetched by a link unfurler', () => {
    expect(statSync(png).size).toBeLessThanOrEqual(300 * 1024)
  })
})
