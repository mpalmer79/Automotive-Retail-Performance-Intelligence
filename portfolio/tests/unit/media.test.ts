/**
 * The committed media, and the claims made about it.
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * This site publishes five product images and one social card. The five product
 * images carry a strong claim: that they are straight captures of routes of this
 * application. A reader cannot check that claim. These tests are the check.
 *
 * THE SOCIAL CARD NO LONGER CARRIES THAT CLAIM, AND SAYING SO IS THE POINT.
 * Until ADR-0016 it was governed output — an SVG whose every figure was reconciled
 * here against `buildExecutiveOverview()`, character for character. It is now a
 * supplied raster whose figures are illustrative and do NOT reconcile with the
 * governed selectors. That is a real reduction in what this file can prove, it is
 * recorded in ADR-0016 rather than left to be inferred from a deleted test, and the
 * rules that a raster still admits are asserted further down against the one piece of
 * text the card still has: its alternative text.
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
 *   - a social card at the wrong size, over its byte budget, or served from a path
 *     the metadata does not point at,
 *   - a retired social asset reappearing, or the supplied card being overwritten by
 *     a regenerated one,
 *   - alternative text that quotes an unreconciled figure as though it were a result.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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

describe('the social card', () => {
  const png = join(PUBLIC_DIR, OG_IMAGE_PATH)

  it('is committed at the declared path', () => {
    expect(existsSync(png), `${OG_IMAGE_PATH} is not committed`).toBe(true)
  })

  it('is served from the brand directory, where its master used to live', () => {
    // ADR-0016. One file at one path: the card is committed where it is served from,
    // rather than being an output rendered from a master somewhere else.
    expect(OG_IMAGE_PATH).toBe('/brand/social-preview.png')
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

  it('stays small enough to be fetched by a link unfurler', () => {
    expect(statSync(png).size).toBeLessThanOrEqual(300 * 1024)
  })
})

/* -------------------------------------------------------------------------- */
/* The retired social-card architecture                                        */
/* -------------------------------------------------------------------------- */

/**
 * ADR-0016 retired an SVG master and a rendered output. Both are deleted, and these
 * tests are what stop either from coming back by accident.
 *
 * The failure modes are silent, which is why they are worth a test rather than a note.
 * A regenerated `public/social-preview.png` would sit at a URL nothing references, so
 * the site would carry two social cards free to disagree. A render target pointed at
 * `public/brand/social-preview.png` would OVERWRITE the supplied card with whatever it
 * drew. Neither breaks a build; both are only visible on a share preview.
 */
describe('the retired social-card architecture stays retired', () => {
  it('no longer keeps a rendered card at the public root', () => {
    expect(
      existsSync(join(PUBLIC_DIR, 'social-preview.png')),
      'public/social-preview.png was retired by ADR-0016 and has come back'
    ).toBe(false)
  })

  it('no longer keeps an SVG master for the card', () => {
    expect(
      existsSync(join(PUBLIC_DIR, 'brand/social-preview.svg')),
      'brand/social-preview.svg was retired by ADR-0016 and has come back'
    ).toBe(false)
  })

  it('cannot be regenerated by the raster pipeline', () => {
    // The script that used to write the card. It must name neither retired path: not
    // the old output, and not the supplied card it would overwrite.
    const script = readFileSync(
      join(process.cwd(), 'scripts/render-raster-assets.ts'),
      'utf8'
    )
    const targets = [...script.matchAll(/output:\s*'([^']+)'/g)].map((match) => match[1])
    expect(targets).not.toContain('social-preview.png')
    expect(targets).not.toContain('brand/social-preview.png')
    expect([...script.matchAll(/source:\s*'([^']+)'/g)].map((m) => m[1])).not.toContain(
      'brand/social-preview.svg'
    )
  })
})

/* -------------------------------------------------------------------------- */
/* What replaced the figure reconciliation                                     */
/* -------------------------------------------------------------------------- */

/**
 * THE SAFEGUARD THIS BLOCK REPLACES, AND WHY IT COULD NOT SURVIVE UNCHANGED.
 *
 * Until ADR-0016 this file asserted that EVERY figure drawn on the social card equalled
 * the figure `buildExecutiveOverview()` computes, character for character. That was a
 * strong rule and it was mechanically checkable for one reason only: the card was an SVG,
 * so its figures were text a test could read.
 *
 * The card is now a supplied raster. There is no text to read, so the reconciliation
 * cannot be performed at all — and the current asset would not pass it if it could. Its
 * figures are illustrative: it labels 92 as `ROSI`, a metric this project does not define;
 * it prints `Total Sales $3,499`, which is the governed value of gross per retail unit;
 * and its 64% inventory health and 20.5% close rate do not reconcile with the governed
 * 40.4% aged inventory and 1.5% lead-to-sale conversion. ADR-0016 records that trade
 * openly rather than leaving a deleted test to imply the rule was met.
 *
 * WHAT IS ASSERTED INSTEAD IS NOT NOTHING. The card still has text — its alternative
 * text — and that is the copy a screen-reader user actually receives. So the honesty
 * rules move onto it: the alt text may not quote a figure as though it were a result, it
 * must say the rendering is illustrative, and it stays under the fairness freeze that
 * forbids naming a store or an employee on the one surface whose context cannot travel
 * with the picture.
 *
 * This is a genuinely weaker guarantee than reconciliation and is recorded as such. It is
 * the strongest rule that a raster admits.
 */
describe('the social card does not present itself as governed output', () => {
  it('says in its alternative text that the figures are illustrative', () => {
    expect(OG_IMAGE_ALT).toMatch(/illustrative/i)
    expect(OG_IMAGE_ALT).toMatch(/not governed output/i)
  })

  it('carries the synthetic-data disclosure the image itself has lost', () => {
    /*
     * THE REGRESSION THIS PINS, STATED PLAINLY. The retired card printed "Synthetic
     * data" and "Granite Auto Group is fictional" on the face of the image. The supplied
     * raster prints neither while still drawing dealership KPI tiles, so the alt text is
     * now the ONLY place the disclosure survives — and it reaches a screen-reader user
     * rather than someone looking at a share preview.
     *
     * That is a weaker position than the project held before, it is recorded in ADR-0016
     * and in DESIGN_SYSTEM.md section 8, and this test is what stops the last remaining
     * copy of the disclosure being edited away too.
     */
    expect(OG_IMAGE_ALT).toMatch(/synthetic/i)
    expect(OG_IMAGE_ALT).toMatch(/fictional/i)
  })

  it('quotes no figure as though it were a result', () => {
    /*
     * The load-bearing assertion. The previous card was allowed to print values BECAUSE
     * they reconciled; this one does not reconcile, so its description may not read any
     * value out. A currency amount, a percentage or a unit count in this string would
     * reach a screen-reader user with nothing to mark it as illustrative.
     */
    expect(OG_IMAGE_ALT, 'the alt text quotes a currency amount').not.toMatch(/\$[\d,]+/)
    expect(OG_IMAGE_ALT, 'the alt text quotes a percentage').not.toMatch(
      /\d+(\.\d+)?\s?%/
    )
    expect(OG_IMAGE_ALT, 'the alt text quotes a unit count').not.toMatch(
      /\b\d[\d,]*\s+(retail units|units|leads|deals|appointments)\b/i
    )
  })

  it('claims no business result', () => {
    for (const forbidden of [
      /\bincreased? (sales|gross|revenue|profit|turn)\b/i,
      /\bimproved? (sales|gross|revenue|profit|turn)\b/i,
      /\breduced? (days supply|aging|aged inventory)\b/i,
      /\b\d+% (increase|improvement|lift|growth)\b/i,
      /\bROI\b/,
    ]) {
      expect(OG_IMAGE_ALT, 'the alt text asserts a business result').not.toMatch(
        forbidden
      )
    }
  })

  it('names no store and no employee', () => {
    // The fairness freeze, kept from the retired block. In the product a store
    // comparison carries its disclosures; cropped into a social card it reads as a
    // league table.
    for (const store of dashboardStores) {
      for (const naming of [store.name, store.shortName]) {
        expect(OG_IMAGE_ALT, `the card names the store "${naming}"`).not.toContain(naming)
      }
    }
    expect(OG_IMAGE_ALT).not.toMatch(/\bsalesperson|\badvisor\b|\bemployee of\b/i)
  })
})
