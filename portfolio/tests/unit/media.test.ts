/**
 * The committed media, and the claims made about it.
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * This site publishes five product images and one social card, and it makes a
 * strong claim about all six: that they are straight captures of routes of this
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
 *   - a social card served from a path nothing else agrees with, or a retired one
 *     that has come back.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { TARGETS } from '../../scripts/raster-targets.ts'
import { TOUR_STEPS } from '@/components/sections/product-tour'
import { dashboardStores } from '@/lib/dashboard/data'
import {
  OG_IMAGE_ALT,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
} from '@/lib/metadata'

const PUBLIC_DIR = join(process.cwd(), 'public')

/**
 * The largest a product capture may be, in bytes.
 *
 * The four explorer captures sit between 46 and 63 kB. The console capture is 97
 * kB, and the difference is the subject rather than the encoder: it is the only
 * one photographed at the full viewport height, and its first screen is a
 * navigation rail, a control band, eight KPI cards with sparklines and three
 * modules of geometry, where an explorer is largely one panel of flat surface.
 * It is encoded at the same quality 80 as the other four.
 *
 * 112 kB is therefore headroom for a re-take at a slightly different crop and
 * still a wall for one accidentally written at quality 100 or without the
 * resize, which is what this budget is for. Every capture is `loading="lazy"`
 * and only the selected step's image is in the DOM, so no reader ever pays for
 * more than one.
 */
const CAPTURE_MAX_BYTES = 112 * 1024

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
  it('shows five steps, one per explorable route', () => {
    expect(TOUR_STEPS).toHaveLength(5)
    // Three of the five point at a technical VIEW rather than at a route of its
    // own: `UX.1` consolidated the six documentation routes into `/technical`,
    // and a tour step that pointed at a redirect would send a reader through a hop
    // to reach the thing it is showing them.
    //
    // The first is the operating console, and its position is asserted rather
    // than incidental: `ADR-0015` made `/` the front door, and a tour that opens
    // on an explorer opens on something other than the product.
    expect(TOUR_STEPS.map((step) => step.href)).toEqual([
      '/',
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

/*
 * WHAT THIS BLOCK USED TO ASSERT, AND WHY IT NO LONGER CAN.
 *
 * Until the social card became a supplied raster, it was drawn as
 * `public/brand/social-preview.svg` and rendered to `public/social-preview.png`
 * by `npm run assets`. Because the master was SVG, its text was machine
 * readable, and this block read it: the card had to name the author, state that
 * Granite Auto Group is fictional, carry the synthetic-data disclosure in a
 * bordered panel, name no store and no employee, and — the strongest assertion —
 * print no KPI figure that `buildExecutiveOverview()` could not reproduce, so a
 * card could not go stale when the synthetic dataset was regenerated.
 *
 * The card is now a hand-supplied PNG at `public/brand/social-preview.png`. A
 * raster has no extractable text, so none of those assertions can run against
 * it, and the artwork does not satisfy them in any case: it prints an
 * `Inventory Health` ring, a lead funnel and a `ROSI` tile that are not outputs
 * of this product, and it carries no synthetic-data disclosure.
 *
 * THIS WAS A DELIBERATE, AUTHORISED RELAXATION OF THE PROJECT'S HONESTY POLICY,
 * NOT AN OVERSIGHT. The trade and what was given up are recorded in
 * `docs/DESIGN_SYSTEM.md` section 8, `docs/CONTENT_MODEL.md`, and the
 * superseding note on row 12 of `FINAL_RELEASE_AUDIT.md`. What survives is
 * asserted below: the disclosure moved to `og:image:alt`, which is the only text
 * on this surface a platform still renders, and the fairness freeze on naming a
 * store or an employee is applied to that text instead.
 *
 * If the card is ever redrawn from a machine-readable master, restore the
 * figure-provenance assertions rather than leaving this comment as their
 * epitaph.
 */
describe('the social card', () => {
  const png = join(PUBLIC_DIR, OG_IMAGE_PATH)
  const retiredPng = join(PUBLIC_DIR, 'social-preview.png')
  const retiredSvg = join(PUBLIC_DIR, 'brand/social-preview.svg')

  it('is declared at the canonical brand path', () => {
    expect(OG_IMAGE_PATH).toBe('/brand/social-preview.png')
  })

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

  it('is the only production social card in public/', () => {
    // Two OG PNGs is the failure this change exists to remove: one of them wins
    // in metadata and the other rots, and nothing tells you which is which.
    expect(
      existsSync(retiredPng),
      'public/social-preview.png is retired; /brand/social-preview.png is the card'
    ).toBe(false)
    expect(
      existsSync(retiredSvg),
      'the SVG master is retired; it must not come back as a second authority'
    ).toBe(false)
  })

  it('cannot be recreated by the raster pipeline', () => {
    /*
     * The teeth on the previous assertion. Deleting the file is not enough while
     * `npm run assets` still knows how to write it: the next person to run the
     * generator would silently republish a retired card at a path metadata no
     * longer points at.
     */
    expect(TARGETS.map((target) => target.output)).toEqual([
      'favicon-32.png',
      'apple-touch-icon.png',
    ])
    for (const target of TARGETS) {
      expect(target.output, 'a raster target writes a social card').not.toMatch(
        /social-preview/
      )
      expect(target.source, 'a raster target reads a social-card master').not.toMatch(
        /social-preview/
      )
    }
  })

  /*
   * The card is a raster and its text cannot be read, so the disclosure that
   * used to be asserted ON the artwork is asserted on the alternative text
   * instead — see the block comment above this describe for what that replaced.
   * `og:image:alt` is the only text on this surface a platform renders.
   */
  describe('the alternative text carries what the artwork no longer states', () => {
    it('discloses the synthetic data and the fictional group', () => {
      expect(OG_IMAGE_ALT).toMatch(/synthetic/i)
      expect(OG_IMAGE_ALT).toMatch(/fictional/i)
    })

    it('names the author', () => {
      expect(OG_IMAGE_ALT).toContain('Michael Palmer')
    })

    it('does not present the figures on the card as governed output', () => {
      // The artwork's tiles are not this product's computed values. The alt text
      // must not repeat them as though they were, and must say what they are.
      expect(OG_IMAGE_ALT).toMatch(/illustrative/i)
      expect(
        OG_IMAGE_ALT,
        'the alt text quotes a currency figure, which reads as a governed result'
      ).not.toMatch(/\$[\d,]+/)
    })

    it('names no store and no employee', () => {
      // Fairness freeze, applied to the one surface whose context cannot travel
      // with the picture. In the product a store comparison carries its
      // disclosures; cropped into a social card it reads as a league table.
      for (const store of dashboardStores) {
        for (const naming of [store.name, store.shortName]) {
          expect(OG_IMAGE_ALT, `the alt text names the store "${naming}"`).not.toContain(
            naming
          )
        }
      }
      expect(OG_IMAGE_ALT).not.toMatch(/\bsalesperson|\badvisor\b|\bemployee of\b/i)
    })

    it('describes the card rather than selling the project', () => {
      expect(OG_IMAGE_ALT.length).toBeGreaterThan(200)
      expect(OG_IMAGE_ALT).not.toMatch(/screenshot|image of|picture of/i)
    })
  })

  /*
   * THE BUDGET WENT UP FROM 300 kB, AND THE REASON IS THE SUBJECT, NOT SLOPPINESS.
   *
   * The old card was a flat SVG rendered at 1200x630 and compressed to 104 kB.
   * The supplied card is a soft-gradient composition with roughly 70,000 unique
   * colours, which is the case PNG compresses worst. Every lossless route was
   * measured — Pillow's optimiser, zopfli, and four resample filters — and the
   * best result is 584 kB; the 631 kB committed here is the LANCZOS resize, kept
   * because it is the sharpest of the four on the card's small type. Getting
   * under 300 kB would mean quantising the palette, which would band the
   * gradients and alter the supplied artwork.
   *
   * It stays a budget rather than becoming no rule at all, because the failure it
   * catches is real: an accidental re-export at 1731x909, or with 16-bit depth,
   * lands well above this. 700 kB is headroom over the measured 631 kB and still
   * an order of magnitude inside what every consumer accepts — LinkedIn and X cap
   * at 5 MB, Facebook at 8 MB.
   *
   * No reader pays for it. `docs/PERFORMANCE.md` records that this file is
   * fetched by a crawler building a share card and is never requested by a page.
   */
  it('stays small enough to be fetched by a link unfurler', () => {
    expect(statSync(png).size).toBeLessThanOrEqual(700 * 1024)
  })
})
