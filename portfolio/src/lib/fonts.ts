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
 * from the Google Fonts CDN. Total shipped weight is roughly 116 kB across all
 * three, and the exact byte sizes are recorded in
 * portfolio/docs/PERFORMANCE.md section 5.
 *
 * Licensing - all three are SIL Open Font License 1.1, which permits
 * embedding, subsetting and redistribution:
 *
 *   Inter           Rasmus Andersson      https://github.com/rsms/inter
 *   Source Serif 4  Frank Griesshammer    https://github.com/adobe-fonts/source-serif
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
 * Display face. An editorial serif, restricted to the wordmark, h1 and h2 only.
 *
 * WHY A SERIF, AND WHY THIS ONE
 * -----------------------------
 * The visual direction pairs a traditional brand register with clean modern
 * interface text. A second sans cannot carry the first half of that, so Space
 * Grotesk - a display SANS - was removed rather than kept alongside this. The
 * direction permits one serif, one sans and one mono; a display sans plus a
 * body sans is two sans families.
 *
 * THE FILE IS NOT THE ONE GOOGLE SERVES
 * -------------------------------------
 * Source Serif 4's variable font ships two axes, `wght` 200-900 and `opsz`
 * 8-60, and the latin subset of the full thing is 122 kB - larger than the
 * other two families put together. It is instanced before being committed:
 * `opsz` is pinned at 32, the display-oriented end of the axis, and `wght` is
 * clamped to the 400-700 the site actually uses. That is 36 kB, which is in
 * line with the faces it sits beside.
 *
 * The command is recorded in portfolio/docs/DESIGN_SYSTEM.md section 4 so the
 * file can be regenerated rather than being an artefact nobody can reproduce.
 */
export const sourceSerif = localFont({
  src: [{ path: '../fonts/SourceSerif4-Variable-latin.woff2', style: 'normal' }],
  weight: '400 700',
  display: 'swap',
  variable: '--font-source-serif',
  fallback: ['ui-serif', 'Georgia', 'Times New Roman', 'serif'],
  adjustFontFallback: 'Times New Roman',
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
  sourceSerif.variable,
  jetBrainsMono.variable,
].join(' ')
