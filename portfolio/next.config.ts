import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { NextConfig } from 'next'

import { PORTRAIT_CANDIDATES, PORTRAIT_ENV_VARIABLE } from './src/lib/portrait.ts'
import { LEGACY_TECHNICAL_ROUTES } from './src/lib/technical.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Resolve the approved author portrait, once, at build time.
 *
 * WHY THIS LIVES IN THE CONFIG AND NOT IN THE COMPONENT
 * ----------------------------------------------------
 * `AuthorPortrait` needs to know whether a photograph is committed. It must not
 * find out by asking the file system, because a server component that calls
 * `existsSync` on a path built from `process.cwd()` gives the output tracer
 * nothing it can resolve statically - and the tracer then fails safe by copying
 * the ENTIRE working directory into `.next/standalone`.
 *
 * That happened: the standalone output grew from three entries to the whole
 * `portfolio/` tree, and the Railway image job failed with "/app/tests is
 * present in the runtime image". The fix is not to exclude `tests/` - it is to
 * stop asking the question from inside the traced graph.
 *
 * This file runs in Node at build time and is not part of that graph, so the
 * check is free here. The answer is inlined through `env` below.
 */
function resolvePortraitSource(): string {
  for (const candidate of PORTRAIT_CANDIDATES) {
    if (existsSync(join(HERE, 'public', candidate))) return candidate
  }
  return ''
}

/**
 * ARPI portfolio site build configuration.
 *
 * Deliberate omissions, so that a future reader does not have to guess:
 *   - No `rewrites` or `headers` proxying to an external service, and the one
 *     `redirect` is internal: `/dealerships` to `/`.
 *     The site is entirely source-controlled content.
 *   - No image loader configuration. Every graphic on the site is an inline or
 *     static SVG authored in this repository, so the raster pipeline is unused.
 *   - No `experimental` flags. The site must build on the stable release.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Emit `.next/standalone`: a self-contained server plus only the node_modules
  // it traced as reachable. This is what makes the Railway runtime image small
  // and what lets the runtime stage drop the whole dependency tree, including
  // every development dependency and the Playwright browsers.
  //
  // Two things it does NOT copy, and which the Dockerfile therefore copies by
  // hand - this is documented Next behaviour, not an oversight:
  //   - `public/`      the seven static brand and icon assets
  //   - `.next/static` the fingerprinted CSS and JavaScript a visitor downloads
  // Omitting either produces a site that boots, serves HTML, and has no styling
  // and no favicon. `tests/unit/railway-config.test.ts` asserts both are copied.
  output: 'standalone',

  // Pin the file-tracing root to this directory.
  //
  // Next infers the root by walking up for a lockfile or a workspace manifest,
  // and the DIRECTORY LAYOUT OF `.next/standalone` DEPENDS ON WHAT IT FINDS: a
  // root above `portfolio/` makes the output nest under `standalone/portfolio/`,
  // while a root here makes it flat. The Railway image copies that directory, so
  // an inferred root turns "somebody added a package.json at the repository
  // root" into "the container cannot find server.js" — and the repository root
  // does now carry a package.json, for the Railway IaC tooling.
  //
  // Setting it explicitly makes the layout a property of this file rather than
  // of what happens to be in the build context.
  outputFileTracingRoot: HERE,

  /*
   * Nothing outside the application belongs in the runtime image.
   *
   * Belt and braces rather than the fix: the real defect was a server component
   * asking the file system a question the tracer could not answer, and that is
   * fixed at its source in `src/lib/portrait.ts`. This is the guard for the next
   * one. The CI job asserts `/app/tests`, `/app/sql`, `/app/powerbi`,
   * `/app/docs` and `/app/.git` are absent from the image; declaring the same
   * thing here means a stray trace is dropped at build time instead of failing
   * a job after the image is built.
   */
  outputFileTracingExcludes: {
    '*': [
      './tests/**',
      './docs/**',
      './scripts/**',
      './playwright*.config.ts',
      './vitest.config.ts',
      './eslint.config.mjs',
      './Dockerfile.railway',
    ],
  },

  /*
   * The portrait, resolved above and inlined here.
   *
   * `env` is a build-time substitution: Next replaces the reference with a
   * literal, so this is not a variable an operator can set in a deployment
   * dashboard to make the site claim a photograph it does not have.
   */
  env: { [PORTRAIT_ENV_VARIABLE]: resolvePortraitSource() },

  // Fail the production build on a type error rather than shipping a site whose
  // type check only passes in a separate CI step. Linting is a separate command
  // in Next 16 and is run by the `lint` script and by CI.
  typescript: { ignoreBuildErrors: false },

  // Trailing slashes off keeps canonical URLs and sitemap entries in one form.
  trailingSlash: false,

  poweredByHeader: false,

  // A conservative header policy for everything the site serves directly.
  //
  // The `X-Robots-Tag` on the UI lab used to live only in `vercel.json`, which
  // meant it was a property of one host rather than of the site. Railway serves
  // this application through `next start`, where a `vercel.json` header block is
  // simply never read - so moving to Railway would have silently dropped it and
  // left the lab relying on its `<meta name="robots">` alone. A meta tag is
  // honoured for an HTML document; the header is what covers a crawler that
  // fetches the route without parsing it. It is declared here so it travels with
  // the application to any Node host.
  /**
   * The permanent redirects.
   *
   * EIGHT OF THEM, IN THREE GROUPS, ALL 308.
   *
   *   `/dashboard`            → `/`
   *   `/dealerships`          → `/`
   *   six technical routes    → `/technical?view=...`
   *
   * `/dashboard` IS THE IMPORTANT ONE. ADR-0015 makes the operating console the
   * canonical entry experience, so `/` renders it and the old console URL resolves
   * here. Permanent, because the move is permanent and a 308 tells a crawler to
   * transfer the ranking rather than keep re-checking; 308 rather than 301 because
   * it is the method-preserving form and the filter bar's no-JavaScript path is a
   * GET form whose action could otherwise be rewritten.
   *
   * QUERY STRINGS SURVIVE, AND THAT IS THE WHOLE POINT. Next appends the incoming
   * query to the destination when the destination declares none of its own, so
   * `/dashboard?period=2025-12&store=GSA-002` arrives at
   * `/?period=2025-12&store=GSA-002` and reproduces the view somebody shared. That
   * is asserted in `tests/e2e/navigation.spec.ts` rather than assumed: a redirect
   * that dropped the filters would turn every shared console link into the default
   * period, silently.
   *
   * `source` IS AN EXACT PATH IN EVERY CASE, NEVER A PREFIX. `/dashboard/:path*`
   * would take the seven operating sub-routes with it, which is the opposite of the
   * requirement — they stay exactly where they are and every deep link into them
   * keeps working. Next matches `source` literally unless it carries a parameter
   * segment, so each of these catches one path and nothing beneath it.
   *
   * The six technical sources are derived from `LEGACY_TECHNICAL_ROUTES` rather
   * than typed here, so the redirect, the view registry and the navigation cannot
   * disagree about which view answers for which retired URL.
   */
  async redirects() {
    return [
      {
        source: '/dashboard',
        destination: '/',
        permanent: true,
      },
      {
        source: '/dealerships',
        destination: '/',
        permanent: true,
      },
      ...LEGACY_TECHNICAL_ROUTES.map((entry) => ({
        source: entry.from,
        destination: entry.to,
        permanent: true,
      })),
    ]
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
      {
        source: '/ui-lab',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ]
  },
}

export default nextConfig
