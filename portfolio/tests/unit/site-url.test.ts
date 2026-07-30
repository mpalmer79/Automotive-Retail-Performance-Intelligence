/**
 * Canonical-origin resolution, tested along every ordered path.
 *
 * This is the module that removed `NEXT_PUBLIC_SITE_URL` from the list of things
 * a human has to type into a deployment dashboard, so the property that matters
 * is not just "it returns a URL" but "it returns the RIGHT one, in the right
 * order of preference, and refuses input it should not believe".
 *
 * The last of those is a security property rather than a correctness one: path 4
 * derives an origin from a request, and `Host` is set by whoever made the
 * request. Believing it unconditionally would let anyone who can reach the site
 * mint a canonical tag pointing at a domain they control.
 */
import { describe, expect, it } from 'vitest'

import {
  LOCALHOST_SITE_URL,
  isTrustedRequestHost,
  requestOriginFromHeaders,
  resolveSiteUrl,
  type SiteUrlEnvironment,
} from '../../src/lib/site-url.ts'

/** An empty environment. Every case builds from this, so no test inherits a
 *  variable it did not set. */
const NONE: SiteUrlEnvironment = {}

describe('resolution order', () => {
  it('prefers ARPI_SITE_URL above everything', () => {
    const resolved = resolveSiteUrl(
      {
        ARPI_SITE_URL: 'https://arpi.example.com',
        RAILWAY_PUBLIC_DOMAIN: 'ignored.up.railway.app',
        NEXT_PUBLIC_SITE_URL: 'https://also-ignored.example.com',
      },
      { requestOrigin: 'https://ignored.railway.app' }
    )
    expect(resolved.url).toBe('https://arpi.example.com')
    expect(resolved.source).toBe('arpi-site-url')
  })

  it('falls back to RAILWAY_PUBLIC_DOMAIN, which is the Railway staging case', () => {
    // The whole point of the change: no explicit variable, and the origin is
    // still correct because the platform already knows it.
    const resolved = resolveSiteUrl({
      RAILWAY_PUBLIC_DOMAIN: 'arpi-portfolio-staging.up.railway.app',
    })
    expect(resolved.url).toBe('https://arpi-portfolio-staging.up.railway.app')
    expect(resolved.source).toBe('railway-public-domain')
    expect(resolved.warnings).toEqual([])
  })

  it('orders the deprecated NEXT_PUBLIC_SITE_URL BELOW the Railway domain', () => {
    // A value left over from the Vercel era must never override the platform's
    // statement of where this deployment actually is.
    const resolved = resolveSiteUrl({
      RAILWAY_PUBLIC_DOMAIN: 'arpi-portfolio-staging.up.railway.app',
      NEXT_PUBLIC_SITE_URL: 'https://stale-vercel-domain.example.com',
    })
    expect(resolved.url).toBe('https://arpi-portfolio-staging.up.railway.app')
    expect(resolved.source).toBe('railway-public-domain')
  })

  it('still honours NEXT_PUBLIC_SITE_URL when nothing better exists, with a deprecation warning', () => {
    const resolved = resolveSiteUrl({
      NEXT_PUBLIC_SITE_URL: 'https://arpi.vercel.app',
    })
    expect(resolved.url).toBe('https://arpi.vercel.app')
    expect(resolved.source).toBe('next-public-site-url')
    expect(resolved.warnings.join(' ')).toMatch(/deprecated/i)
  })

  it('uses a trusted request origin when no variable answers', () => {
    const resolved = resolveSiteUrl(NONE, {
      requestOrigin: 'https://arpi-portfolio-pr-12.up.railway.app',
    })
    expect(resolved.url).toBe('https://arpi-portfolio-pr-12.up.railway.app')
    expect(resolved.source).toBe('request-origin')
  })

  it('falls back to localhost, so development and the test suite need no variable', () => {
    const resolved = resolveSiteUrl(NONE)
    expect(resolved.url).toBe(LOCALHOST_SITE_URL)
    expect(resolved.source).toBe('localhost')
    expect(resolved.warnings).toEqual([])
  })
})

describe('normalisation', () => {
  it('strips trailing slashes, so no canonical URL contains a doubled one', () => {
    // `${SITE_URL}${route.href}` is how every canonical tag and sitemap entry is
    // built, so a trailing slash here produces `https://host//kpis` everywhere.
    expect(resolveSiteUrl({ ARPI_SITE_URL: 'https://arpi.example.com/' }).url).toBe(
      'https://arpi.example.com'
    )
    expect(resolveSiteUrl({ ARPI_SITE_URL: 'https://arpi.example.com///' }).url).toBe(
      'https://arpi.example.com'
    )
  })

  it('reduces a URL with a path to its origin', () => {
    // A path on the canonical origin would be concatenated onto every route.
    expect(
      resolveSiteUrl({ ARPI_SITE_URL: 'https://arpi.example.com/some/path?q=1#x' }).url
    ).toBe('https://arpi.example.com')
  })

  it('adds https to a bare RAILWAY_PUBLIC_DOMAIN', () => {
    // Railway supplies a bare hostname and always terminates TLS.
    expect(resolveSiteUrl({ RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' }).url).toBe(
      'https://x.up.railway.app'
    )
  })

  it('tolerates a RAILWAY_PUBLIC_DOMAIN that already carries a scheme', () => {
    expect(
      resolveSiteUrl({ RAILWAY_PUBLIC_DOMAIN: 'https://x.up.railway.app' }).url
    ).toBe('https://x.up.railway.app')
  })

  it('keeps a non-default port', () => {
    expect(resolveSiteUrl({ ARPI_SITE_URL: 'http://localhost:4321' }).url).toBe(
      'http://localhost:4321'
    )
  })

  it('trims surrounding whitespace, which a dashboard text field collects silently', () => {
    expect(resolveSiteUrl({ RAILWAY_PUBLIC_DOMAIN: '  x.up.railway.app  ' }).url).toBe(
      'https://x.up.railway.app'
    )
  })
})

describe('malformed input is skipped, never trusted, and never silent', () => {
  it('ignores an empty or whitespace-only value without warning', () => {
    // An empty variable is indistinguishable from an unset one and is not worth
    // a warning; a dashboard produces them by accident constantly.
    const resolved = resolveSiteUrl({ ARPI_SITE_URL: '   ', RAILWAY_PUBLIC_DOMAIN: '' })
    expect(resolved.source).toBe('localhost')
    expect(resolved.warnings).toEqual([])
  })

  it.each([
    ['not a url at all', 'arpi.example.com'],
    ['a scheme-relative URL', '//arpi.example.com'],
    ['a file URL', 'file:///etc/passwd'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,<h1>x</h1>'],
  ])('ignores %s in ARPI_SITE_URL and records a warning', (_label, value) => {
    const resolved = resolveSiteUrl({ ARPI_SITE_URL: value })
    expect(resolved.source).toBe('localhost')
    expect(resolved.warnings.join(' ')).toMatch(/ARPI_SITE_URL/)
  })

  it.each([
    ['a path', 'x.up.railway.app/foo'],
    ['embedded credentials', 'user@x.up.railway.app'],
    ['a space', 'x.up.railway .app'],
    ['a backslash', 'x.up.railway.app\\foo'],
  ])('ignores a RAILWAY_PUBLIC_DOMAIN containing %s', (_label, value) => {
    const resolved = resolveSiteUrl({ RAILWAY_PUBLIC_DOMAIN: value })
    expect(resolved.source).toBe('localhost')
    expect(resolved.warnings.join(' ')).toMatch(/RAILWAY_PUBLIC_DOMAIN/)
  })

  it('falls through from a malformed explicit value to a valid Railway domain', () => {
    // A typo in the override must not take the site off its real domain.
    const resolved = resolveSiteUrl({
      ARPI_SITE_URL: 'nonsense',
      RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app',
    })
    expect(resolved.url).toBe('https://x.up.railway.app')
    expect(resolved.source).toBe('railway-public-domain')
    expect(resolved.warnings.join(' ')).toMatch(/ARPI_SITE_URL/)
  })
})

describe('a request origin is only believed for an allow-listed host', () => {
  it.each([
    'localhost',
    'localhost:3000',
    '127.0.0.1',
    '127.0.0.1:8080',
    'anything.railway.app',
    'arpi-portfolio-staging.up.railway.app',
    'ARPI-PORTFOLIO.UP.RAILWAY.APP',
  ])('trusts %s', (host) => {
    expect(isTrustedRequestHost(host)).toBe(true)
  })

  it.each([
    'evil.example.com',
    // The canonical-injection shapes: a domain that merely CONTAINS the trusted
    // suffix, or appends it as a path or a subdomain of an attacker's domain.
    'railway.app.evil.com',
    'up.railway.app.evil.com',
    'notrailway.app.attacker.net',
    'evil.com',
  ])('does not trust %s', (host) => {
    expect(isTrustedRequestHost(host)).toBe(false)
  })

  it('ignores an untrusted request origin and records a warning', () => {
    const resolved = resolveSiteUrl(NONE, { requestOrigin: 'https://evil.example.com' })
    expect(resolved.url).toBe(LOCALHOST_SITE_URL)
    expect(resolved.source).toBe('localhost')
    expect(resolved.warnings.join(' ')).toMatch(/allow-list/i)
  })

  it('never lets a Host header override an explicit or platform value', () => {
    // The property that makes path 4 safe to have at all: it is last but for the
    // localhost fallback, so it can never displace something authoritative.
    for (const env of [
      { ARPI_SITE_URL: 'https://arpi.example.com' },
      { RAILWAY_PUBLIC_DOMAIN: 'real.up.railway.app' },
      { NEXT_PUBLIC_SITE_URL: 'https://legacy.example.com' },
    ]) {
      const resolved = resolveSiteUrl(env, {
        requestOrigin: 'https://attacker.up.railway.app',
      })
      expect(resolved.source).not.toBe('request-origin')
    }
  })
})

describe('assembling a request origin from headers', () => {
  const headersOf = (entries: Record<string, string>) => ({
    get: (name: string) => entries[name.toLowerCase()] ?? null,
  })

  it('prefers x-forwarded-host and x-forwarded-proto', () => {
    expect(
      requestOriginFromHeaders(
        headersOf({
          'x-forwarded-host': 'a.up.railway.app',
          'x-forwarded-proto': 'https',
          host: 'internal:3000',
        })
      )
    ).toBe('https://a.up.railway.app')
  })

  it('takes the first hop from a comma-separated x-forwarded-proto chain', () => {
    expect(
      requestOriginFromHeaders(
        headersOf({ host: 'a.up.railway.app', 'x-forwarded-proto': 'https,http' })
      )
    ).toBe('https://a.up.railway.app')
  })

  it('defaults to https when the protocol header is absent or nonsense', () => {
    // Railway terminates TLS, so https is the safe default. Defaulting to http
    // would emit an http canonical URL for a site served over https.
    expect(requestOriginFromHeaders(headersOf({ host: 'a.up.railway.app' }))).toBe(
      'https://a.up.railway.app'
    )
    expect(
      requestOriginFromHeaders(
        headersOf({ host: 'a.up.railway.app', 'x-forwarded-proto': 'gopher' })
      )
    ).toBe('https://a.up.railway.app')
  })

  it('honours an explicit http protocol, for local development', () => {
    expect(
      requestOriginFromHeaders(
        headersOf({ host: 'localhost:3000', 'x-forwarded-proto': 'http' })
      )
    ).toBe('http://localhost:3000')
  })

  it('returns undefined rather than a guess when there is no host', () => {
    expect(requestOriginFromHeaders(headersOf({}))).toBeUndefined()
    expect(requestOriginFromHeaders(headersOf({ host: '  ' }))).toBeUndefined()
  })
})

describe('the resolved value is always usable as a URL base', () => {
  it.each([
    ['explicit', { ARPI_SITE_URL: 'https://arpi.example.com/' }],
    ['railway', { RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' }],
    ['legacy', { NEXT_PUBLIC_SITE_URL: 'https://legacy.example.com' }],
    ['localhost', {}],
  ])(
    '%s resolves to something new URL() accepts and no trailing slash',
    (_label, env) => {
      const { url } = resolveSiteUrl(env)
      expect(() => new URL(url)).not.toThrow()
      expect(url.endsWith('/')).toBe(false)
      expect(url).toMatch(/^https?:\/\//)
    }
  )
})
