/**
 * What `npm run assets` is allowed to render, as data.
 *
 * Separated from `render-raster-assets.ts` so the list can be asserted without
 * importing Chromium. `tests/unit/media.test.ts` reads it to prove that the
 * generator can no longer produce a social card; importing the script itself
 * would pull `@playwright/test` into a jsdom unit run to check two strings.
 *
 * THE SOCIAL CARD DOES NOT BELONG IN THIS LIST. It is a hand-supplied raster
 * committed at `public/brand/social-preview.png` and named once, in
 * `src/lib/metadata.ts`. A target here that wrote a social card would give the
 * site a second production Open Graph PNG and a generator able to overwrite an
 * image it does not own.
 */
export interface RasterTarget {
  /** Path of the SVG master, relative to `public/`. */
  readonly source: string
  /** Path of the rendered PNG, relative to `public/`. */
  readonly output: string
  readonly width: number
  readonly height: number
}

export const TARGETS: readonly RasterTarget[] = [
  { source: 'favicon.svg', output: 'favicon-32.png', width: 32, height: 32 },
  { source: 'favicon.svg', output: 'apple-touch-icon.png', width: 180, height: 180 },
]
