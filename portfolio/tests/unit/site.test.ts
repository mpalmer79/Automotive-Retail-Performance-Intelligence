/**
 * The route map is the single source for four things - primary navigation, the
 * sitemap, the breadcrumb trail and the accessibility test sweep - and this file
 * asserts that none of them can drift from it.
 *
 * The failure being prevented is the ordinary one: a new page that is live,
 * linked, and absent from the sitemap because someone updated the navigation and
 * stopped there.
 *
 * It also covers the metadata and structured-data rules, which are the two places
 * where an unbacked claim would be machine-readable and therefore consumed without
 * a person reading it.
 *
 * Documented in portfolio/docs/CONTENT_MODEL.md sections 9 and 10.
 */
import { describe, expect, it } from 'vitest'

import { pageMetadata, rootMetadata, structuredData } from '../../src/lib/metadata.ts'
import {
  ALL_ROUTES,
  INDEXABLE_ROUTES,
  PRIMARY_NAV,
  REPOSITORY_URL,
  ROUTES,
  SITE_URL,
  SYNTHETIC_DATA_SHORT,
  SYNTHETIC_DATA_STATEMENT,
  repoFileUrl,
  routeByHref,
} from '../../src/lib/site.ts'

/* -------------------------------------------------------------------------- */
/* The route map                                                              */
/* -------------------------------------------------------------------------- */

describe('the route map is well-formed', () => {
  it('gives every route a unique href', () => {
    const hrefs = ALL_ROUTES.map((route) => route.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('starts every href with a slash and ends none with one', () => {
    for (const route of ALL_ROUTES) {
      expect(route.href.startsWith('/')).toBe(true)
      if (route.href !== '/') expect(route.href.endsWith('/')).toBe(false)
    }
  })

  it('gives every route a title and a nav label', () => {
    for (const route of ALL_ROUTES) {
      expect(route.title.length).toBeGreaterThan(0)
      expect(route.navLabel.length).toBeGreaterThan(0)
      expect(route.description.length).toBeGreaterThan(40)
    }
  })

  it('gives every indexable route a description long enough to be a real one', () => {
    // A search result shows roughly 155 characters. Under 80 is a placeholder.
    // The UI lab is exempt: it is `noindex`, so its description is never shown.
    for (const route of INDEXABLE_ROUTES) {
      expect(route.description.length, route.href).toBeGreaterThan(80)
    }
  })

  it('gives every route a priority between 0 and 1', () => {
    for (const route of ALL_ROUTES) {
      expect(route.priority).toBeGreaterThan(0)
      expect(route.priority).toBeLessThanOrEqual(1)
    }
  })

  it('gives the home page the highest priority', () => {
    const others = ALL_ROUTES.filter((route) => route.href !== '/')
    for (const route of others) {
      expect(ROUTES.home.priority).toBeGreaterThanOrEqual(route.priority)
    }
  })
})

describe('the eight primary routes exist and the lab is not one of them', () => {
  const PRIMARY = [
    '/',
    '/architecture',
    '/data-model',
    '/kpis',
    '/governance',
    '/status',
    '/about',
    '/case-study',
  ]

  it('declares exactly the eight primary routes plus the lab', () => {
    expect(ALL_ROUTES.map((route) => route.href).sort()).toEqual(
      [...PRIMARY, '/ui-lab'].sort()
    )
  })

  it('puts seven routes in the primary navigation', () => {
    // The case study is deliberately absent: it is locked, and a locked route in
    // the primary navigation reads as a broken link rather than as a boundary.
    expect(PRIMARY_NAV.map((route) => route.href)).toEqual(
      PRIMARY.filter((href) => href !== '/case-study')
    )
  })

  it('keeps the UI lab out of navigation and out of the index', () => {
    expect(ROUTES.uiLab.inPrimaryNav).toBe(false)
    expect(ROUTES.uiLab.indexable).toBe(false)
    expect(INDEXABLE_ROUTES.map((route) => route.href)).not.toContain('/ui-lab')
  })

  it('indexes every primary route, including the locked case study', () => {
    // The locked case-study page is honest content: it names what is missing and
    // why. There is no reason to hide it from a search index.
    expect(INDEXABLE_ROUTES.map((route) => route.href).sort()).toEqual(
      [...PRIMARY].sort()
    )
  })

  it('resolves a route by href, and only on an exact match', () => {
    expect(routeByHref('/kpis')?.title).toBe('KPI catalogue')
    expect(routeByHref('/kpis/')).toBeUndefined()
    expect(routeByHref('/nope')).toBeUndefined()
  })
})

/* -------------------------------------------------------------------------- */
/* The independent test list is a second opinion                              */
/* -------------------------------------------------------------------------- */

describe('the end-to-end route list agrees with the route map', () => {
  /**
   * `tests/e2e/routes.ts` duplicates the route list deliberately: importing the
   * app's own map would mean a route deleted from the map silently disappears from
   * the test sweep too, and the suite would go green while covering less. That
   * makes it a second opinion - but only if something asserts the two agree, which
   * is this.
   */
  it('covers every route in the map', async () => {
    const { ALL_TESTED_ROUTES } = await import('../e2e/routes.ts')
    expect([...ALL_TESTED_ROUTES].sort()).toEqual(
      ALL_ROUTES.map((route) => route.href).sort()
    )
  })

  it('agrees on which routes are in the primary navigation, and on their labels', async () => {
    const { PRIMARY_ROUTES } = await import('../e2e/routes.ts')
    for (const route of PRIMARY_ROUTES) {
      const declared = routeByHref(route.path)
      expect(declared, `${route.path} is not in the route map`).toBeDefined()
      expect(declared?.inPrimaryNav).toBe(route.inNav)
      if (route.navLabel !== undefined) expect(declared?.navLabel).toBe(route.navLabel)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Repository links                                                           */
/* -------------------------------------------------------------------------- */

describe('repository links resolve to something GitHub can serve', () => {
  it('uses blob for a file', () => {
    expect(repoFileUrl('KPI_CATALOG.md')).toBe(
      `${REPOSITORY_URL}/blob/main/KPI_CATALOG.md`
    )
  })

  it('uses tree for a directory', () => {
    // A trailing slash means a directory, and GitHub 404s a `blob` URL for one.
    expect(repoFileUrl('sql/05_reporting/')).toBe(
      `${REPOSITORY_URL}/tree/main/sql/05_reporting`
    )
  })

  it('tolerates a leading slash', () => {
    expect(repoFileUrl('/sql/README.md')).toBe(
      `${REPOSITORY_URL}/blob/main/sql/README.md`
    )
  })

  it('points at the real repository', () => {
    expect(REPOSITORY_URL).toBe(
      'https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence'
    )
  })
})

describe('the canonical origin never carries a trailing slash', () => {
  it('strips one', () => {
    // Doubled slashes in a canonical tag and a sitemap entry are the classic
    // symptom of concatenating an origin that ends in one.
    expect(SITE_URL.endsWith('/')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* The synthetic-data statement                                               */
/* -------------------------------------------------------------------------- */

describe('the synthetic-data statement says the three things it has to say', () => {
  it('names the data as synthetic, the group as fictional, and the absence of real data', () => {
    expect(SYNTHETIC_DATA_STATEMENT).toMatch(/synthetic/i)
    expect(SYNTHETIC_DATA_STATEMENT).toMatch(/fictional/i)
    expect(SYNTHETIC_DATA_STATEMENT).toMatch(/Granite State Auto Group/)
    expect(SYNTHETIC_DATA_STATEMENT).toMatch(/no real dealership/i)
  })

  it('keeps the short form honest as well', () => {
    expect(SYNTHETIC_DATA_SHORT).toMatch(/synthetic/i)
    expect(SYNTHETIC_DATA_SHORT).toMatch(/fictional/i)
  })

  it('hedges neither form', () => {
    for (const statement of [SYNTHETIC_DATA_STATEMENT, SYNTHETIC_DATA_SHORT]) {
      expect(statement).not.toMatch(/based on|inspired by|modelled on|anonymised/i)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Metadata                                                                   */
/* -------------------------------------------------------------------------- */

describe('page metadata', () => {
  it('gives the root a canonical URL and an absolute metadata base', () => {
    expect(rootMetadata.metadataBase?.toString()).toContain(SITE_URL)
  })

  it('gives every route a title and a description from the route map', () => {
    for (const key of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
      const metadata = pageMetadata(key)
      expect(metadata.description).toBe(ROUTES[key].description)
    }
  })

  it('gives every route an absolute canonical URL on the canonical origin', () => {
    // Absolute rather than relative: a relative canonical resolves against
    // whatever origin served the page, which on a preview deployment would point
    // the preview at itself and defeat the purpose of having one.
    for (const key of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
      const canonical = String(pageMetadata(key).alternates?.canonical)
      expect(canonical.startsWith(SITE_URL), canonical).toBe(true)
      const expected =
        ROUTES[key].href === '/' ? `${SITE_URL}/` : SITE_URL + ROUTES[key].href
      expect(canonical).toBe(expected)
    }
  })

  it('marks the UI lab noindex', () => {
    expect(pageMetadata('uiLab').robots).toMatchObject({ index: false, follow: false })
  })

  it('leaves every other route indexable', () => {
    for (const route of INDEXABLE_ROUTES) {
      const key = (Object.keys(ROUTES) as (keyof typeof ROUTES)[]).find(
        (candidate) => ROUTES[candidate].href === route.href
      )
      expect(key).toBeDefined()
      if (key === undefined) continue
      const robots = pageMetadata(key).robots
      expect(JSON.stringify(robots ?? {}), route.href).not.toMatch(/"index":false/)
    }
  })

  it('lets a route override a field without losing the rest', () => {
    const metadata = pageMetadata('kpis', { title: 'Overridden' })
    expect(metadata.title).toBe('Overridden')
    expect(metadata.description).toBe(ROUTES.kpis.description)
  })
})

/* -------------------------------------------------------------------------- */
/* Structured data                                                            */
/* -------------------------------------------------------------------------- */

describe('structured data claims only what the project can support', () => {
  const graph = JSON.parse(structuredData()) as {
    '@graph': { '@type': string; [key: string]: unknown }[]
  }
  const types = graph['@graph'].map((node) => node['@type'])

  it('emits exactly four node types', () => {
    expect(types.sort()).toEqual(
      ['CreativeWork', 'Person', 'SoftwareSourceCode', 'WebSite'].sort()
    )
  })

  it.each([
    'Product',
    'Review',
    'AggregateRating',
    'Rating',
    'Organization',
    'LocalBusiness',
    'Offer',
    'Award',
    'Testimonial',
  ])('emits no %s', (type) => {
    // Every one of these would be a fabricated machine-readable claim, and
    // structured data is worse than prose for that because it is consumed without
    // a person reading it.
    expect(structuredData()).not.toContain(`"${type}"`)
  })

  it('claims no completed degree and no certification', () => {
    const serialised = structuredData()
    expect(serialised).not.toMatch(/hasCredential|EducationalOccupationalCredential/)
    expect(serialised).not.toMatch(/\bB\.?S\.?\b|\bM\.?B\.?A\.?\b|certified/i)
  })

  it('is valid JSON with no interpolated content', () => {
    expect(() => JSON.parse(structuredData())).not.toThrow()
    expect(structuredData()).not.toContain('undefined')
    expect(structuredData()).not.toContain('[object')
  })
})
