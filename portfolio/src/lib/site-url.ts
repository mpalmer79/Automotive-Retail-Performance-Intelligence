/**
 * Canonical-origin resolution.
 *
 * WHY THIS IS A MODULE OF ITS OWN
 * ------------------------------
 * The site previously required an operator to type its own URL into a deployment
 * dashboard as `NEXT_PUBLIC_SITE_URL`. That is the single most error-prone
 * variable a static site can have: get it wrong and every canonical tag, every
 * sitemap entry and every Open Graph URL points somewhere the site is not, and
 * nothing in the build fails. Railway publishes the deployment's own hostname as
 * `RAILWAY_PUBLIC_DOMAIN`, so on Railway the correct value is already present and
 * asking a person for it can only introduce a mistake.
 *
 * This module is therefore the one place the origin is decided, it is a pure
 * function of its inputs, and every ordered path through it is covered by
 * `tests/unit/site-url.test.ts`.
 *
 * RESOLUTION ORDER
 * ----------------
 *   1. `ARPI_SITE_URL`          an explicit, server-only override. The escape
 *                               hatch for a custom domain, and the only value a
 *                               human is ever expected to set.
 *   2. `RAILWAY_PUBLIC_DOMAIN`  the platform's own answer. Bare hostname, so it
 *                               is given the `https://` scheme here.
 *   3. `NEXT_PUBLIC_SITE_URL`   DEPRECATED. Retained so an existing Vercel
 *                               deployment keeps working; see the note below.
 *   4. a request origin         only when supplied by a caller that has a real
 *                               request, and only for a host on the allow-list.
 *   5. `http://localhost:3000`  development and the test suite need no variable.
 *
 * WHY `ARPI_SITE_URL` AND NOT `NEXT_PUBLIC_ARPI_SITE_URL`
 * ------------------------------------------------------
 * `NEXT_PUBLIC_` is not a namespace, it is an instruction to Next to inline the
 * value into the client bundle. The origin is only ever needed while rendering
 * on the server - metadata, the sitemap, robots.txt, JSON-LD - so there is no
 * reason to publish it into JavaScript a visitor downloads. The server-only name
 * keeps that boundary visible in the variable itself.
 *
 * ON `NEXT_PUBLIC_SITE_URL`
 * -------------------------
 * Deprecated, not removed. It is ordered BELOW `RAILWAY_PUBLIC_DOMAIN` on
 * purpose: a value left over from an earlier host must never win against the
 * platform's statement of where this deployment actually is. An operator who
 * genuinely wants to override the platform sets `ARPI_SITE_URL`, which is
 * ordered above it. Removing `NEXT_PUBLIC_SITE_URL` outright is a separate
 * change and is tracked in portfolio/docs/DEPLOYMENT.md section 3.
 */

/** The documented development fallback. No variable is required to develop. */
export const LOCALHOST_SITE_URL = 'http://localhost:3000'

/**
 * Hosts whose `Host` header may be believed when resolving an origin from a
 * request.
 *
 * A request origin is attacker-controlled: `Host` is set by whoever made the
 * request, so believing it unconditionally would let anyone who can reach the
 * site mint a canonical tag pointing at a domain they control. That is a real
 * SEO-poisoning primitive, not a theoretical one, which is why path 4 exists
 * behind an allow-list rather than as a plain fallback.
 */
const TRUSTED_REQUEST_HOST_SUFFIXES: readonly string[] = [
  '.railway.app',
  '.up.railway.app',
]

const TRUSTED_REQUEST_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]']

/** Which input decided the origin. Reported so a deployment can be verified. */
export type SiteUrlSource =
  | 'arpi-site-url'
  | 'railway-public-domain'
  | 'next-public-site-url'
  | 'request-origin'
  | 'localhost'

/**
 * The subset of the environment this module reads. Nothing else is consulted.
 *
 * The index signature is required, not decorative: `process.env` is typed as
 * `ProcessEnv`, and TypeScript's weak-type detection rejects passing it to an
 * object type made only of optional properties. The named keys stay so that a
 * reader can see the whole input surface in one place, and so a test can build
 * an environment without casting.
 */
export interface SiteUrlEnvironment {
  readonly ARPI_SITE_URL?: string | undefined
  readonly RAILWAY_PUBLIC_DOMAIN?: string | undefined
  readonly NEXT_PUBLIC_SITE_URL?: string | undefined
  readonly [key: string]: string | undefined
}

export interface ResolveSiteUrlOptions {
  /**
   * An origin taken from a live request, already assembled by the caller from
   * the forwarded protocol and host. Ignored unless its host is on the
   * allow-list above.
   */
  readonly requestOrigin?: string | undefined
}

export interface ResolvedSiteUrl {
  /** Absolute origin, scheme included, with no trailing slash. */
  readonly url: string
  readonly source: SiteUrlSource
  /**
   * Inputs that were present but unusable, in resolution order. A malformed
   * value is skipped rather than thrown on - a bad canonical URL must not take
   * a documentation site off the air - but it is never skipped silently: the
   * deployment verifier and `tests/unit/site-url.test.ts` both read this.
   */
  readonly warnings: readonly string[]
}

/** Strip trailing slashes. `//` in a canonical tag is the classic symptom. */
function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Normalise a value that is supposed to already be an absolute origin.
 * Returns `null` when it is not one, so the caller can fall through.
 */
function normaliseAbsolute(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  // A `file:` or `javascript:` origin in a canonical tag is worse than none.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.hostname === '') return null

  // Deliberately origin-only: a path, query or fragment on the canonical origin
  // would be concatenated onto every route and produce nonsense.
  return withoutTrailingSlash(parsed.origin)
}

/**
 * Normalise `RAILWAY_PUBLIC_DOMAIN`, which Railway supplies as a bare hostname
 * such as `arpi-portfolio-staging.up.railway.app`. A scheme is tolerated in case
 * a future platform release adds one, but is not required.
 */
function normaliseRailwayDomain(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null

  // Already carries a scheme - treat it as an absolute origin.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return normaliseAbsolute(trimmed)

  // A bare host must not contain a path, a space, or credentials.
  if (/[\s/\\?#@]/.test(trimmed)) return null

  // Railway always terminates TLS, so the public origin is always https.
  return normaliseAbsolute(`https://${trimmed}`)
}

/** Whether a request's host may be believed. See the allow-list above. */
export function isTrustedRequestHost(host: string): boolean {
  const lower = host.toLowerCase()
  // Compare on hostname alone; a port never changes whether a host is trusted.
  const withoutPort = lower.startsWith('[')
    ? (lower.match(/^\[[^\]]*\]/)?.[0] ?? lower)
    : (lower.split(':')[0] ?? lower)

  if (TRUSTED_REQUEST_HOSTS.includes(withoutPort)) return true
  return TRUSTED_REQUEST_HOST_SUFFIXES.some((suffix) => withoutPort.endsWith(suffix))
}

function normaliseRequestOrigin(raw: string | undefined): string | null {
  const absolute = normaliseAbsolute(raw)
  if (absolute === null) return null
  const { host } = new URL(absolute)
  return isTrustedRequestHost(host) ? absolute : null
}

/**
 * Resolve the canonical origin.
 *
 * Pure: it reads nothing but its arguments, which is what makes every path
 * through it testable without a deployment.
 */
export function resolveSiteUrl(
  env: SiteUrlEnvironment,
  options: ResolveSiteUrlOptions = {}
): ResolvedSiteUrl {
  const warnings: string[] = []

  const explicit = normaliseAbsolute(env.ARPI_SITE_URL)
  if (explicit !== null) return { url: explicit, source: 'arpi-site-url', warnings }
  if (env.ARPI_SITE_URL !== undefined && env.ARPI_SITE_URL.trim() !== '') {
    warnings.push(
      'ARPI_SITE_URL is set but is not an absolute http(s) origin, so it was ignored.'
    )
  }

  const railway = normaliseRailwayDomain(env.RAILWAY_PUBLIC_DOMAIN)
  if (railway !== null) {
    return { url: railway, source: 'railway-public-domain', warnings }
  }
  if (
    env.RAILWAY_PUBLIC_DOMAIN !== undefined &&
    env.RAILWAY_PUBLIC_DOMAIN.trim() !== ''
  ) {
    warnings.push(
      'RAILWAY_PUBLIC_DOMAIN is set but is not a usable hostname, so it was ignored.'
    )
  }

  const legacy = normaliseAbsolute(env.NEXT_PUBLIC_SITE_URL)
  if (legacy !== null) {
    warnings.push(
      'NEXT_PUBLIC_SITE_URL is deprecated. Set the server-only ARPI_SITE_URL instead, ' +
        'or rely on RAILWAY_PUBLIC_DOMAIN on Railway.'
    )
    return { url: legacy, source: 'next-public-site-url', warnings }
  }
  if (env.NEXT_PUBLIC_SITE_URL !== undefined && env.NEXT_PUBLIC_SITE_URL.trim() !== '') {
    warnings.push(
      'NEXT_PUBLIC_SITE_URL is set but is not an absolute http(s) origin, so it was ignored.'
    )
  }

  const request = normaliseRequestOrigin(options.requestOrigin)
  if (request !== null) return { url: request, source: 'request-origin', warnings }
  if (options.requestOrigin !== undefined && options.requestOrigin.trim() !== '') {
    warnings.push(
      'A request origin was supplied but its host is not on the trusted allow-list, ' +
        'so it was ignored.'
    )
  }

  return { url: LOCALHOST_SITE_URL, source: 'localhost', warnings }
}

/**
 * Assemble an origin from forwarded request headers, for a caller that has a
 * request in hand.
 *
 * Returns `undefined` rather than a guess when the headers are absent or
 * unusable, so `resolveSiteUrl` falls through to the localhost path instead of
 * fabricating an origin.
 *
 * NOT WIRED INTO THE STATIC METADATA PATH, DELIBERATELY
 * ----------------------------------------------------
 * Every route on this site is statically prerendered, so there is no request in
 * scope when `metadataBase`, the sitemap or robots.txt are produced - the origin
 * for those is decided once, at build time, from the environment. Making them
 * per-request in order to read a `Host` header would make the site's canonical
 * URLs vary with an attacker-controlled header for no benefit, since Railway has
 * already told the build what the domain is. This helper therefore exists for a
 * caller that genuinely renders per request, and the allow-list above is what
 * makes such a caller safe. Recorded in portfolio/docs/DEPLOYMENT.md section 3.
 */
export function requestOriginFromHeaders(
  headers: Pick<Headers, 'get'>
): string | undefined {
  const host = headers.get('x-forwarded-host') ?? headers.get('host')
  if (host === null || host.trim() === '') return undefined

  // `x-forwarded-proto` may be a comma-separated chain; the first hop is the one
  // the client spoke.
  const forwardedProto = headers.get('x-forwarded-proto')
  const proto = (forwardedProto?.split(',')[0] ?? '').trim().toLowerCase()
  const scheme = proto === 'http' || proto === 'https' ? proto : 'https'

  return `${scheme}://${host.trim()}`
}
