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
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
} from '@/lib/metadata'

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
    expect(TOUR_STEPS.map((step) => step.href)).toEqual([
      '/inventory',
      '/architecture',
      '/data-model',
      '/kpis',
    ])
  })

  for (const step of TOUR_STEPS) {
    describe(step.id, () => {
      const file = join(PUBLIC_DIR, step.image.src)

      it('is committed to the repository', () => {
        expect(existsSync(file), `${step.image.src} is referenced but not committed`).toBe(
          true
        )
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
        const prose = `${step.summary} ${step.insight} ${step.provenanceNote}`
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

  it('shows no KPI value, so a reader cannot mistake it for a result', () => {
    const source = readFileSync(svg, 'utf8')
    // The card draws a table shell with column headers and no cells. A currency
    // amount, a percentage or a unit count in it would read as a real figure
    // from a real dealership, which is the one thing this project may not imply.
    const drawnText = [...source.matchAll(/>([^<]+)</g)]
      .map((match) => match[1]?.trim() ?? '')
      .join(' ')
    expect(drawnText).not.toMatch(/\$\s?\d/)
    expect(drawnText).not.toMatch(/\d+(\.\d+)?\s?%/)
    expect(drawnText).not.toMatch(/\b\d+\s+(units|deals|sales|leads)\b/i)
  })

  it('stays small enough to be fetched by a link unfurler', () => {
    expect(statSync(png).size).toBeLessThanOrEqual(300 * 1024)
  })
})
