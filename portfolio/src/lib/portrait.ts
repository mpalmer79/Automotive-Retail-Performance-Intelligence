/**
 * The author-portrait contract.
 *
 * CONSTANTS ONLY. NOTHING HERE MAY TOUCH THE FILE SYSTEM.
 * ------------------------------------------------------
 * This module is imported by a server component, and that makes it part of the
 * graph Next traces to decide what goes into `.next/standalone`. The tracer
 * (`@vercel/nft`) follows `fs` calls statically, and when it meets one whose
 * path it cannot resolve - `existsSync(join(process.cwd(), 'public'))` being the
 * exact case - it fails safe by including the ENTIRE working directory.
 *
 * That is not a theoretical concern. The first version of `AuthorPortrait` did
 * exactly that, and the standalone output went from three entries
 * (`node_modules`, `package.json`, `server.js`) to the whole `portfolio/` tree:
 * `tests/`, `docs/`, `scripts/`, `src/`, every config file. The Railway image
 * job caught it - `/app/tests is present in the runtime image` - which is
 * precisely the assertion that check exists to make.
 *
 * So the presence check happens ONCE, at build time, in `next.config.ts`, which
 * runs in Node outside the traced graph. It inlines the answer as
 * {@link PORTRAIT_ENV_VARIABLE}, and the component reads a string. No `fs`
 * reaches the server bundle, and the standalone output stays three entries.
 *
 * The contract for the file itself - ratio, dimensions, format, byte ceiling,
 * crop and background - is documented on `components/media/author-portrait.tsx`
 * and in `portfolio/README.md` section 4.
 */

/** The reserved geometry. Both the real asset and the placeholder occupy it. */
export const PORTRAIT_WIDTH = 1000
export const PORTRAIT_HEIGHT = 1250

/** The maximum the contract allows, in bytes. Asserted by the unit suite. */
export const PORTRAIT_MAX_BYTES = 180 * 1024

/**
 * The public paths that count as an approved portrait, in preference order.
 *
 * Two, not one, so a better format can be supplied without a code change. There
 * is deliberately no `.jpg` and no `.png`: this site serves modern formats for
 * every other image it has, a portrait is not the place to make an exception,
 * and a closed list is what stops a stock photograph arriving by dropping a file
 * into the directory.
 */
export const PORTRAIT_CANDIDATES = [
  '/media/michael-palmer-portrait.avif',
  '/media/michael-palmer-portrait.webp',
] as const

/** The path documented for the person supplying the file. */
export const PORTRAIT_DOCUMENTED_PATH =
  'portfolio/public/media/michael-palmer-portrait.webp'

/**
 * The build-time variable carrying the resolved portrait path, or an empty
 * string when none is committed.
 *
 * Set by `next.config.ts` through Next's `env` option, which inlines it at build
 * time - so this is a literal in the built output, not a value read at run time,
 * and an operator cannot set it in a deployment dashboard to make the site
 * render a portrait that is not in the repository.
 */
export const PORTRAIT_ENV_VARIABLE = 'ARPI_PORTRAIT_SOURCE'

/**
 * Interpret the inlined value.
 *
 * Anything that is not one of the two candidate paths resolves to `null`. That
 * is the same fail-closed rule `lib/flags.ts` applies to every other build
 * input: a variable may withhold the portrait, never invent one.
 */
export function portraitSourceFrom(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const value = raw.trim()
  if (value === '') return null
  return (PORTRAIT_CANDIDATES as readonly string[]).includes(value) ? value : null
}
