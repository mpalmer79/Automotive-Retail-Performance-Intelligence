import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { NextConfig } from 'next'

/**
 * ARPI portfolio site build configuration.
 *
 * Deliberate omissions, so that a future reader does not have to guess:
 *   - No `rewrites`, `redirects` or `headers` proxying to an external service.
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
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),

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
