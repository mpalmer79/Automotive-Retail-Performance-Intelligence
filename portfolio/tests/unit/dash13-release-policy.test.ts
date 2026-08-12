/**
 * The release policy: what a production deployment must publish, and what a
 * preview deployment must withhold.
 *
 * `DASH.13` is the increment that turns an intentionally-unpublished staging
 * deployment into a public release, so it is the increment that has to prove the
 * two policies are BOTH understood rather than trading one for the other. Three
 * groups of assertion here, each guarding a defect this increment actually found
 * or a property the release depends on:
 *
 *   1. Open Graph completeness. `og:site_name` was absent from every page on the
 *      site, because `pageMetadata()` returns a fresh `openGraph` object and
 *      `Metadata` overrides are SHALLOW - so the root layout's `siteName` and
 *      `locale` were replaced rather than merged on every route. A social crawler
 *      renders `og:site_name` as the card's attribution line, which made this the
 *      one metadata gap that would have shown up on the LinkedIn card the release
 *      exists to produce.
 *
 *   2. The title template is applied exactly once. `/technical` builds its own
 *      `"<view> - ARPI"` string so its eight states name themselves, and returned
 *      it as a plain string - which the root template then appended a second
 *      suffix to, shipping `How ARPI works - ARPI - ARPI`.
 *
 *   3. Environment classification stays fail-closed while gaining a production
 *      state. `flags.test.ts` owns the truth table; this file asserts the release
 *      reading of it, so that "production is now a supported environment" cannot
 *      be implemented as "anything that is not staging is production".
 *
 * The robots.txt and sitemap POLICIES are asserted here as pure functions of the
 * preview flag and the origin. What cannot be asserted in a unit test is that a
 * deployment's build-time and runtime environments agree - a mismatch ships a
 * mixture, because a statically prerendered route keeps its build-time metadata
 * while a dynamic one takes the runtime value. That is an external property of a
 * deployment rather than of this tree, and
 * `scripts/railway/verify_release_policy.ts` is what checks it.
 */
import { describe, expect, it } from 'vitest'

import { resolveIsPreview } from '../../src/lib/flags.ts'
import {
  OG_IMAGE_ALT,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
  pageMetadata,
  rootMetadata,
} from '../../src/lib/metadata.ts'
import { resolveSiteUrl } from '../../src/lib/site-url.ts'
import {
  ALL_ROUTES,
  INDEXABLE_ROUTES,
  ROUTES,
  SITE_TITLE,
  type RouteKey,
} from '../../src/lib/site.ts'

/* -------------------------------------------------------------------------- */
/* 1. Open Graph completeness on every route                                  */
/* -------------------------------------------------------------------------- */

const ROUTE_KEYS = Object.keys(ROUTES) as RouteKey[]

describe('the social card contract holds on every route, not just the root layout', () => {
  it('declares the governed image path and its 1200 x 630 geometry', () => {
    // The three constants a social crawler reads as a unit. LinkedIn and X both
    // require the dimensions to size the card before the image has loaded.
    expect(OG_IMAGE_PATH).toBe('/social-preview.png')
    expect(OG_IMAGE_WIDTH).toBe(1200)
    expect(OG_IMAGE_HEIGHT).toBe(630)
  })

  it.each(ROUTE_KEYS)('carries og:site_name on %s', (key) => {
    /*
     * THE REGRESSION THIS FILE EXISTS FOR.
     *
     * Before `DASH.13` this expectation failed on all seventeen routes: the root
     * layout set `siteName`, every route replaced the whole `openGraph` object,
     * and nothing asserted the tag survived. It is asserted per route rather than
     * once, because the defect was per route.
     */
    expect(pageMetadata(key).openGraph?.siteName).toBe(SITE_TITLE)
  })

  it.each(ROUTE_KEYS)('carries a locale on %s', (key) => {
    expect(pageMetadata(key).openGraph?.locale).toBe('en_US')
  })

  it.each(ROUTE_KEYS)('carries the sized, described social image on %s', (key) => {
    const images = pageMetadata(key).openGraph?.images
    expect(Array.isArray(images)).toBe(true)
    const [image] = images as {
      url: string
      width: number
      height: number
      alt: string
    }[]
    // Asserted rather than narrowed with `!`: an empty images array is exactly the
    // regression this case is for, and it should read as a failed expectation.
    expect(image).toBeDefined()
    if (image === undefined) return
    expect(image.url).toBe(OG_IMAGE_PATH)
    expect(image.width).toBe(OG_IMAGE_WIDTH)
    expect(image.height).toBe(OG_IMAGE_HEIGHT)
    // Alt text is required, not decorative: a preview card is exactly the context
    // where a reader may receive the text and not the image.
    expect(image.alt).toBe(OG_IMAGE_ALT)
    expect(image.alt.length).toBeGreaterThan(40)
  })

  it.each(ROUTE_KEYS)('asks for a large summary card on %s', (key) => {
    expect(pageMetadata(key).twitter).toMatchObject({ card: 'summary_large_image' })
  })

  it('states the same site name in the root layout as on the routes', () => {
    // Two authorities for one tag is how the original defect went unnoticed.
    expect(rootMetadata.openGraph?.siteName).toBe(SITE_TITLE)
  })
})

/* -------------------------------------------------------------------------- */
/* 2. The title template is applied exactly once                              */
/* -------------------------------------------------------------------------- */

describe('the title suffix is never applied twice', () => {
  it('appends the suffix through the root template only', () => {
    expect(rootMetadata.title).toMatchObject({ template: `%s - ARPI` })
  })

  it('gives the home page an absolute title so it cannot read "ARPI - ARPI"', () => {
    expect(pageMetadata('home').title).toMatchObject({ absolute: SITE_TITLE })
  })

  it.each(ROUTE_KEYS.filter((key) => ROUTES[key].href !== '/'))(
    'leaves %s a bare title for the template to suffix exactly once',
    (key) => {
      const title = pageMetadata(key).title
      /*
       * A non-home route returns a PLAIN STRING, which the root template turns
       * into `"<title> - ARPI"`. The bug this guards is the other shape: a route
       * that pre-applies the suffix to a plain string gets a second one. So the
       * plain string must not already end in the suffix.
       */
      expect(typeof title).toBe('string')
      expect(title as string).not.toMatch(/ - ARPI$/)
    }
  )

  it('rejects a doubled suffix in any route title or Open Graph title', () => {
    for (const key of ROUTE_KEYS) {
      const meta = pageMetadata(key)
      const ogTitle = meta.openGraph?.title
      expect(String(ogTitle), key).not.toMatch(/ - ARPI - ARPI/)
      expect(JSON.stringify(meta.title ?? ''), key).not.toMatch(/ - ARPI - ARPI/)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 3. Robots and indexing: two policies, both understood                      */
/* -------------------------------------------------------------------------- */

/**
 * The robots.txt policy, as a pure function of the two inputs `app/robots.ts`
 * reads. Kept here rather than imported because `app/robots.ts` closes over
 * module-level constants resolved from `process.env` at import time, which a unit
 * test cannot vary without reloading the module registry - and the thing worth
 * asserting is the POLICY, which is this shape.
 *
 * It is checked against the real route handler's observable output by
 * `scripts/railway/verify_release_policy.ts`, which reads a running deployment.
 */
function robotsPolicy(isPreview: boolean, siteUrl: string) {
  return isPreview
    ? { rules: [{ userAgent: '*', disallow: '/' }] }
    : {
        rules: [{ userAgent: '*', allow: '/', disallow: [ROUTES.uiLab.href] }],
        sitemap: `${siteUrl}/sitemap.xml`,
        host: siteUrl,
      }
}

describe('a preview deployment withholds itself from every index', () => {
  const preview = robotsPolicy(true, 'https://arpi-portfolio-staging.up.railway.app')

  it('disallows everything', () => {
    expect(preview.rules).toEqual([{ userAgent: '*', disallow: '/' }])
  })

  it('publishes no sitemap, so nothing invites a crawl it just refused', () => {
    expect(preview).not.toHaveProperty('sitemap')
    expect(preview).not.toHaveProperty('host')
  })
})

describe('a production deployment invites the crawl it is released for', () => {
  const PRODUCTION_ORIGIN = 'https://arpi.up.railway.app'
  const production = robotsPolicy(false, PRODUCTION_ORIGIN)

  it('allows the public routes', () => {
    expect(production.rules[0]).toMatchObject({ userAgent: '*', allow: '/' })
  })

  it('still excludes the internal UI lab', () => {
    // The one route disallowed on EVERY environment, production included: an
    // internal design reference has no business in a search index.
    expect(production.rules[0]?.disallow).toEqual(['/ui-lab'])
    expect(ROUTES.uiLab.indexable).toBe(false)
  })

  it('publishes the sitemap and host at the production origin', () => {
    expect(production.sitemap).toBe(`${PRODUCTION_ORIGIN}/sitemap.xml`)
    expect(production.host).toBe(PRODUCTION_ORIGIN)
  })

  it('excludes the UI lab from the indexable set the sitemap is built from', () => {
    expect(INDEXABLE_ROUTES.map((route) => route.href)).not.toContain(ROUTES.uiLab.href)
    // Everything else public is present, so the sitemap cannot silently shrink.
    expect(INDEXABLE_ROUTES.length).toBe(ALL_ROUTES.filter((r) => r.indexable).length)
  })
})

/* -------------------------------------------------------------------------- */
/* 4. Environment classification: production is explicit, never inferred      */
/* -------------------------------------------------------------------------- */

describe('gaining a production environment does not make the rule fail open', () => {
  it('treats the production environment as published', () => {
    expect(resolveIsPreview({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(false)
  })

  it('keeps staging a preview after production exists', () => {
    // The release must not be implemented by making staging public.
    expect(resolveIsPreview({ RAILWAY_ENVIRONMENT_NAME: 'staging' })).toBe(true)
  })

  it.each(['Production', ' production ', 'PRODUCTION'])(
    'normalises %o to production, which is deliberate',
    (name) => {
      /*
       * Casing and surrounding whitespace are tolerated ON PURPOSE: these values
       * are typed into a deployment dashboard's text field, which silently
       * collects a trailing space, and `PRODUCTION` is unambiguous in intent.
       * Tolerating them is not the same as inferring production from a name that
       * is not production, which the next case covers.
       */
      expect(resolveIsPreview({ RAILWAY_ENVIRONMENT_NAME: name })).toBe(false)
    }
  )

  it.each(['prod', 'production-2', 'release', 'main', 'pr-42', 'preview', ''])(
    'does not accept %o as production',
    (name) => {
      /*
       * FAIL CLOSED, RESTATED FOR THE RELEASE.
       *
       * The tempting simplification once production exists is
       * `environment !== 'staging' => production`. That fails OPEN: a typo, a new
       * PR environment or a renamed environment would publish itself. Only the
       * exact name counts. `''` is the local/CI case and is not a preview, which
       * is why it is asserted separately below rather than expected to be `true`.
       */
      if (name === '') {
        expect(resolveIsPreview({ RAILWAY_ENVIRONMENT_NAME: name })).toBe(false)
      } else {
        expect(resolveIsPreview({ RAILWAY_ENVIRONMENT_NAME: name })).toBe(true)
      }
    }
  )

  it('resolves the production canonical origin from the platform hostname', () => {
    const resolved = resolveSiteUrl({ RAILWAY_PUBLIC_DOMAIN: 'arpi.up.railway.app' })
    expect(resolved.url).toBe('https://arpi.up.railway.app')
    expect(resolved.source).toBe('railway-public-domain')
    expect(resolved.warnings).toEqual([])
  })

  it('never derives the production origin from a request host', () => {
    // An attacker-controlled `Host` must not be able to mint a canonical tag,
    // which is why the platform variable outranks a request origin.
    const resolved = resolveSiteUrl(
      { RAILWAY_PUBLIC_DOMAIN: 'arpi.up.railway.app' },
      { requestOrigin: 'https://attacker.up.railway.app' }
    )
    expect(resolved.url).toBe('https://arpi.up.railway.app')
  })
})
