/**
 * Font loading.
 *
 * Three families, loaded from woff2 files committed to this repository under
 * `src/fonts/`. `next/font/local` fingerprints them into the build output and
 * emits a metric-matched fallback face, so the swap produces no layout shift.
 *
 * Why local rather than `next/font/google`: the Google loader fetches font
 * binaries from `fonts.gstatic.com` at *build* time. That makes a production
 * build depend on a third-party host being reachable, which would mean CI can
 * go red for a reason unrelated to the change under review. Committed files
 * make the build hermetic and byte-reproducible.
 *
 * Each file is the **latin subset only** of the family's variable font, taken
 * from the Google Fonts CDN. Total shipped weight is roughly 102 kB across all
 * three, and the exact byte sizes are recorded in
 * portfolio/docs/PERFORMANCE.md section 5.
 *
 * Licensing - all three are SIL Open Font License 1.1, which permits
 * embedding, subsetting and redistribution:
 *
 *   Inter           Rasmus Andersson      https://github.com/rsms/inter
 *   Space Grotesk   Florian Karsten       https://github.com/floriankarsten/space-grotesk
 *   JetBrains Mono  JetBrains s.r.o.      https://github.com/JetBrains/JetBrainsMono
 *
 * Restated with the shipped subsets and the OFL text location in
 * portfolio/docs/DESIGN_SYSTEM.md section 4.
 */
import localFont from 'next/font/local'

/** Interface and body copy. Variable 400-700 on one axis, one file. */
export const inter = localFont({
  src: [{ path: '../fonts/Inter-Variable-latin.woff2', style: 'normal' }],
  weight: '400 700',
  display: 'swap',
  variable: '--font-inter',
  fallback: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
  adjustFontFallback: 'Arial',
  preload: true,
})

/**
 * Display face. Restricted to the wordmark, h1 and h2 only. Its wider technical
 * letterforms carry the instrument-panel register Inter does not, and confining
 * it to two heading levels stops it becoming the page voice.
 */
export const spaceGrotesk = localFont({
  src: [{ path: '../fonts/SpaceGrotesk-Variable-latin.woff2', style: 'normal' }],
  weight: '500 700',
  display: 'swap',
  variable: '--font-space-grotesk',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
  adjustFontFallback: 'Arial',
  preload: true,
})

/**
 * Monospace. One job: technical identifiers. KPI IDs, schema and table names,
 * column names, declared fact grains, SQL and DAX fragments, source paths,
 * validation hashes. Never used for prose.
 *
 * Not preloaded. It appears below the fold on most routes, and preloading a
 * third face competes with the two that render the headline.
 */
export const jetBrainsMono = localFont({
  src: [{ path: '../fonts/JetBrainsMono-Variable-latin.woff2', style: 'normal' }],
  weight: '400 500',
  display: 'swap',
  variable: '--font-jetbrains-mono',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
  adjustFontFallback: false,
  preload: false,
})

export const fontVariables = [
  inter.variable,
  spaceGrotesk.variable,
  jetBrainsMono.variable,
].join(' ')
