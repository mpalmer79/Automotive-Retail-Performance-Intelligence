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

  // Fail the production build on a type error rather than shipping a site whose
  // type check only passes in a separate CI step. Linting is a separate command
  // in Next 16 and is run by the `lint` script and by CI.
  typescript: { ignoreBuildErrors: false },

  // Trailing slashes off keeps canonical URLs and sitemap entries in one form.
  trailingSlash: false,

  poweredByHeader: false,

  // Long-lived immutable caching for the fingerprinted asset pipeline, and a
  // conservative policy for everything the site serves directly. `X-Robots-Tag`
  // for the UI lab is set on the route itself, not here, so that it travels
  // with the route if the route moves.
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
    ]
  },
}

export default nextConfig
