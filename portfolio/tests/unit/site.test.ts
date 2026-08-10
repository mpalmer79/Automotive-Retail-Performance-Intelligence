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
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { pageMetadata, rootMetadata, structuredData } from '../../src/lib/metadata.ts'
import {
  ALL_ROUTES,
  INDEXABLE_ROUTES,
  GROUP_NAV,
  MAX_PRIMARY_NAV_ITEMS,
  NAVIGABLE_ROUTES,
  OPERATING_NAV,
  OPERATING_ROUTE_HREFS,
  PLANNED_DASHBOARD_SECTIONS,
  PRIMARY_NAV,
  UTILITY_NAV,
  isOperatingRoute,
  REPOSITORY_URL,
  ROUTES,
  SITE_URL,
  SYNTHETIC_DATA_SHORT,
  SYNTHETIC_DATA_STATEMENT,
  isNavItemCurrent,
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

describe('the sixteen primary routes exist and the lab is not one of them', () => {
  // Declaration order, which is also navigation order and footer order.
  const PRIMARY = [
    // The operating application, in rail order.
    '/',
    '/dashboard/sales-gross',
    '/dashboard/deals',
    '/dashboard/inventory',
    '/dashboard/fi',
    '/dashboard/leads-marketing',
    '/dashboard/employees',
    '/dashboard/accounting',
    '/dashboard/actions',
    // The reference domain.
    '/technical',
    '/about',
    '/inventory',
    '/dealerships/granite-chevrolet',
    '/dealerships/granite-subaru',
    '/dealerships/granite-pre-owned',
    '/case-study',
  ]

  /**
   * Routes that exist and are indexed but are reached from the body of another
   * page rather than from a navigation surface.
   *
   * The seven operating sub-routes LEFT this list at `UX.1`. They are the rail
   * now — eight peer destinations a manager chooses between — so declaring them
   * unreachable from navigation would be false. What keeps the reference header
   * inside its cap is that the rail is a different navigation on a different half
   * of the site, not that the console's sections are hidden.
   */
  const NOT_IN_NAV = [
    '/case-study',
    '/dealerships/granite-chevrolet',
    '/dealerships/granite-subaru',
    '/dealerships/granite-pre-owned',
  ]

  it('declares exactly the sixteen primary routes plus the lab', () => {
    expect(ALL_ROUTES.map((route) => route.href).sort()).toEqual(
      [...PRIMARY, '/ui-lab'].sort()
    )
  })

  it("keeps every non-store route reachable from the site's own navigation", () => {
    // The case study is deliberately absent: it is locked, and it is reached from
    // the footer and the technical status view rather than from a navigation
    // surface.
    //
    // The three store pages are absent for a different reason. They are reached
    // from `<GroupNav>`, from the group context on the technical overview and from
    // the mobile drawer's expanded group. `inPrimaryNav` governs the footer index
    // and the test sweep, and a store page in either would restate the group four
    // times.
    expect(NAVIGABLE_ROUTES.map((route) => route.href)).toEqual(
      PRIMARY.filter((href) => !NOT_IN_NAV.includes(href))
    )
  })

  it('keeps the UI lab out of navigation and out of the index', () => {
    expect(ROUTES.uiLab.inPrimaryNav).toBe(false)
    expect(ROUTES.uiLab.indexable).toBe(false)
    expect(INDEXABLE_ROUTES.map((route) => route.href)).not.toContain('/ui-lab')
  })

  it('indexes every primary route, including the locked case study and each store', () => {
    // The locked case-study page is honest content: it names what is missing and
    // why. There is no reason to hide it from a search index.
    expect(INDEXABLE_ROUTES.map((route) => route.href).sort()).toEqual(
      [...PRIMARY].sort()
    )
  })

  it('resolves a route by href, and only on an exact match', () => {
    expect(routeByHref('/technical')?.title).toBe('How ARPI works')
    expect(routeByHref('/technical/')).toBeUndefined()
    // A retired route resolves to nothing here BY DESIGN: it is a redirect, and a
    // route map that still knew about it would put it back in the sitemap.
    expect(routeByHref('/kpis')).toBeUndefined()
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

  it('agrees on which routes the site navigates to, and on their labels', async () => {
    const { PRIMARY_ROUTES } = await import('../e2e/routes.ts')
    for (const route of PRIMARY_ROUTES) {
      const declared = routeByHref(route.path)
      expect(declared, `${route.path} is not in the route map`).toBeDefined()
      expect(declared?.inPrimaryNav).toBe(route.inNav)
      if (route.navLabel !== undefined) expect(declared?.navLabel).toBe(route.navLabel)
    }
  })

  it('agrees on the header navigation labels', async () => {
    const { HEADER_NAV } = await import('../e2e/routes.ts')
    expect(HEADER_NAV.map((item) => [item.label, item.path])).toEqual(
      PRIMARY_NAV.map((item) => [item.label, item.href])
    )
  })
})

/* -------------------------------------------------------------------------- */
/* The primary navigation                                                      */
/* -------------------------------------------------------------------------- */

describe('the primary navigation stays inside its budget', () => {
  /**
   * The ceiling is the design decision, not an implementation detail. Seven
   * top-level destinations of equal weight is a table of contents rather than
   * navigation.
   *
   * `UX.1` did not raise it; it stopped needing most of it. The header carried
   * seven items covering both halves of the site at once, and the whole
   * consolidation — six documentation routes into one technical destination, the
   * console into a rail of its own — took it to three. The cap stays because the
   * pressure that produced seven is still there.
   */
  it('offers no more than the agreed number of content destinations', () => {
    expect(PRIMARY_NAV.length).toBeLessThanOrEqual(MAX_PRIMARY_NAV_ITEMS)
  })

  it('offers exactly the three agreed destinations, in order', () => {
    expect(PRIMARY_NAV.map((item) => item.label)).toEqual([
      'Executive',
      'Technical',
      'About',
    ])
  })

  it('leaves the cap unspent rather than filling it', () => {
    // The opposite assertion from the one this replaced, and deliberately so. The
    // previous header sat exactly at the ceiling, so every new destination was a
    // decision to raise it or to group two existing ones. Three items is room a
    // later increment can spend on purpose — `DASH.12` adds an operating
    // destination, not a header one — and an assertion that the header is FULL
    // would now be enforcing a shape the site no longer has.
    expect(PRIMARY_NAV.length).toBeLessThan(MAX_PRIMARY_NAV_ITEMS)
  })

  it('never lists two header items pointing at the same document', () => {
    // The reason "Dealerships" is gone rather than repointed at `/`. Two names
    // for one URL read as two destinations, and the visitor who tries both finds
    // out they were the same page.
    const hrefs = PRIMARY_NAV.map((item) => item.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('reaches every store page from the group sub-navigation', () => {
    // The store pages are not in the header at all, so if they were also missing
    // from GROUP_NAV they would be reachable only from a card on the home page.
    // That is the state this prevents.
    const hrefs = GROUP_NAV.map((item) => item.href)
    for (const href of [
      `${ROUTES.technical.href}?view=overview`,
      ROUTES.graniteChevrolet.href,
      ROUTES.graniteSubaru.href,
      ROUTES.granitePreOwned.href,
      ROUTES.inventory.href,
    ]) {
      expect(hrefs, `${href} is not reachable from GroupNav`).toContain(href)
    }
  })

  it('never puts the locked case study in the header', () => {
    expect(PRIMARY_NAV.map((item) => item.href)).not.toContain(ROUTES.caseStudy.href)
    for (const item of PRIMARY_NAV) {
      expect(item.matches).not.toContain(ROUTES.caseStudy.href)
    }
  })

  it('never puts the internal lab in the header', () => {
    expect(PRIMARY_NAV.map((item) => item.href)).not.toContain(ROUTES.uiLab.href)
  })

  it('points every navigation item and every match at a real route', () => {
    // `GROUP_NAV` is deliberately excluded from the href check: its first
    // entry is a technical VIEW state, `/technical?view=overview`, which is
    // one route at one of its states and so has no entry of its own in the
    // route map. Its `matches` still resolves, and is checked below.
    for (const item of [...PRIMARY_NAV, ...OPERATING_NAV, ...UTILITY_NAV]) {
      expect(routeByHref(item.href), item.href).toBeDefined()
      for (const match of item.matches) {
        expect(routeByHref(match), `${item.label} matches ${match}`).toBeDefined()
      }
    }
  })

  it('gives every navigation item a purpose line for the mobile drawer', () => {
    for (const item of [...PRIMARY_NAV, ...OPERATING_NAV, ...UTILITY_NAV, ...GROUP_NAV]) {
      expect(item.purpose.length, item.label).toBeGreaterThan(20)
    }
  })

  it('marks exactly one item current for every navigable route', () => {
    /*
     * TWO NAVIGATIONS, AND EACH ANSWERS FOR ITS OWN HALF.
     *
     * Before `UX.1` one header covered every navigable route, so one list could be
     * asserted against all of them. The site has two navigations now, on two
     * disjoint sets of routes, and the invariant is per navigation: exactly one
     * current item on a route the navigation serves, and none on a route it does
     * not — which is what stops the reference header lighting up "Executive" while
     * a reader is three clicks into the governance view.
     */
    const NAVIGATIONS = [
      ['operating rail', OPERATING_NAV],
      ['reference header', PRIMARY_NAV],
      ['group sub-navigation', GROUP_NAV],
    ] as const

    for (const route of NAVIGABLE_ROUTES) {
      let marking = 0
      for (const [name, navigation] of NAVIGATIONS) {
        const current = navigation.filter((item) => isNavItemCurrent(item, route.href))
        // Never twice inside ONE navigation: that is a navigation disagreeing with
        // itself about where the reader is.
        expect(
          current.length,
          `${route.href} matches ${String(current.length)} items in the ${name}`
        ).toBeLessThanOrEqual(1)
        marking += current.length
      }
      // And at least one navigation knows where the reader is.
      expect(marking, `${route.href} is current in no navigation`).toBeGreaterThan(0)
    }
  })

  it('lights no reference item on an operating route beyond the way back', () => {
    // "Executive" is current on `/` in both navigations, and correctly: it is the
    // way back into the application AND the application's first destination. On
    // the other seven operating routes the reference header must be silent.
    for (const item of OPERATING_NAV.filter((entry) => entry.href !== '/')) {
      const current = PRIMARY_NAV.filter((entry) => isNavItemCurrent(entry, item.href))
      expect(current, `${item.href} lights the reference header`).toHaveLength(0)
    }
  })

  it('matches on an exact pathname, never on a prefix', () => {
    const technical = PRIMARY_NAV.find((item) => item.label === 'Technical')!
    // A prefix rule would light this up for a route that does not exist yet, and
    // that class of defect only appears once the route is added.
    expect(isNavItemCurrent(technical, '/technical-report')).toBe(false)
    expect(isNavItemCurrent(technical, '/technical')).toBe(true)
  })
})

describe('the group sub-navigation is what makes the Dealerships grouping honest', () => {
  it('links the group page, all three stores and the explorer, in that order', () => {
    expect(GROUP_NAV.map((item) => item.href)).toEqual([
      `${ROUTES.technical.href}?view=overview`,
      ROUTES.graniteChevrolet.href,
      ROUTES.graniteSubaru.href,
      ROUTES.granitePreOwned.href,
      ROUTES.inventory.href,
    ])
  })

  it('keeps every one of them indexable and in the sitemap', () => {
    // The first entry is a technical VIEW state rather than a route of its own, so
    // it is checked against the route it is a state of.
    for (const item of GROUP_NAV) {
      const href = item.href.split('?')[0] ?? item.href
      expect(routeByHref(href)?.indexable, item.href).toBe(true)
    }
  })

  it('gives every store its own route, with no duplicate href', () => {
    const hrefs = GROUP_NAV.map((item) => item.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})

describe('the operating rail is the definition of the operating application', () => {
  it('carries the nine built destinations, in working order', () => {
    expect(OPERATING_NAV.map((item) => item.label)).toEqual([
      'Executive',
      'Sales & Gross',
      'Deals',
      'Inventory',
      'F&I',
      'Leads & Marketing',
      'Employees',
      'Accounting',
      'Actions',
    ])
  })

  it('points every rail item at a route that exists and is indexable', () => {
    for (const item of OPERATING_NAV) {
      expect(routeByHref(item.href)?.indexable, item.href).toBe(true)
    }
  })

  it('offers no link to a section that is not built', () => {
    /*
     * The planned list is EMPTY as of `DASH.12`, which delivered the one section it held.
     * The assertion is unchanged in substance and stronger in form: whatever the list
     * contains must not name a route the application can already navigate to. It passed
     * before because `/dashboard/actions` did not exist; it passes now because nothing is
     * claimed to be missing. A future entry that outlived its increment fails here.
     */
    const planned = PLANNED_DASHBOARD_SECTIONS.map((section) => section.label)
    expect(planned).toEqual([])
    const navLabels = OPERATING_NAV.map((item) => item.label)
    for (const label of planned) {
      expect(
        navLabels,
        `${label} is described as unbuilt but is in the rail`
      ).not.toContain(label)
    }
    // The rail is the definition of the operating application, so every href it derives
    // must point at a route that exists. `/dashboard/actions` is one of them as of
    // `DASH.12`, and was deliberately absent before.
    expect(OPERATING_ROUTE_HREFS).toContain('/dashboard/actions')
  })

  it('treats a Deal Jacket as inside the application and the reference domain as outside', () => {
    expect(isOperatingRoute('/')).toBe(true)
    expect(isOperatingRoute('/dashboard/deals')).toBe(true)
    expect(isOperatingRoute('/dashboard/deals/SLE-00000646')).toBe(true)
    expect(isOperatingRoute('/technical')).toBe(false)
    expect(isOperatingRoute('/inventory')).toBe(false)
    expect(isOperatingRoute('/about')).toBe(false)
  })
})

describe('the reference header is three items and one of them leaves', () => {
  it('opens with a link back into the operating application', () => {
    expect(PRIMARY_NAV[0]?.href).toBe(ROUTES.home.href)
    expect(PRIMARY_NAV[0]?.label).toBe('Executive')
  })

  it('carries the two utility destinations after it', () => {
    expect(PRIMARY_NAV.slice(1).map((item) => item.href)).toEqual(
      UTILITY_NAV.map((item) => item.href)
    )
  })

  it('keeps both utility destinations indexable', () => {
    for (const item of UTILITY_NAV) {
      expect(routeByHref(item.href)?.indexable, item.href).toBe(true)
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
    expect(SYNTHETIC_DATA_STATEMENT).toMatch(/Granite Auto Group/)
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
    const metadata = pageMetadata('technical', { title: 'Overridden' })
    expect(metadata.title).toBe('Overridden')
    expect(metadata.description).toBe(ROUTES.technical.description)
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

/* -------------------------------------------------------------------------- */
/* The planned-section list                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `/dashboard` renders `PLANNED_DASHBOARD_SECTIONS` under the sentence "Every
 * section below is absent because the warehouse entity, reporting view or rule
 * engine behind it does not exist yet." That is a claim about what is NOT built,
 * made by a hand-maintained array, on the page a reader is most likely to quote.
 *
 * It had already gone stale twice. `Deal Jacket` stayed on the list after
 * `DASH.4` shipped `/dashboard/deals/[saleId]`, so the console was telling
 * readers a reachable route did not exist. `DASH.9`'s two routes were never on
 * the list at all, which was the harmless direction of the same drift.
 *
 * The backlog is the authority for what is delivered, so these assertions read
 * it rather than restate it. A list entry naming an increment the backlog calls
 * `Implemented` is the exact failure, and it fails here.
 */
describe('the planned-section list cannot outlive the work it describes', () => {
  const backlog = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../docs/requirements/DASHBOARD_BACKLOG.md'
    ),
    'utf8'
  )

  /** The status column of the increment table, keyed by increment id. */
  const statusOf = (increment: string): string | null => {
    const row = new RegExp(
      `^\\|\\s*\`${increment.replace('.', '\\.')}\`\\s*\\|[^|]*\\|[^|]*\\|\\s*([^|]+?)\\s*\\|`,
      'm'
    )
    return backlog.match(row)?.[1] ?? null
  }

  it('reads a status out of the backlog for every increment it names', () => {
    // If this fails the parse is wrong, not the claim - and every assertion
    // below would otherwise pass vacuously.
    for (const section of PLANNED_DASHBOARD_SECTIONS) {
      expect(statusOf(section.increment), section.increment).not.toBeNull()
    }
    expect(statusOf('DASH.9')).toContain('Implemented')
  })

  it('names no increment the backlog calls implemented', () => {
    for (const section of PLANNED_DASHBOARD_SECTIONS) {
      expect(
        statusOf(section.increment),
        `${section.label} (${section.increment})`
      ).not.toContain('Implemented')
    }
  })

  it('names no section the console can already navigate to', () => {
    const reachable = new Set(
      NAVIGABLE_ROUTES.map((route) => route.navLabel.toLowerCase())
    )
    for (const section of PLANNED_DASHBOARD_SECTIONS) {
      expect(reachable.has(section.label.toLowerCase()), section.label).toBe(false)
    }
  })

  it('does not describe the two DASH.9 routes as absent', () => {
    const labels = PLANNED_DASHBOARD_SECTIONS.map((section) =>
      section.label.toLowerCase()
    )
    expect(labels).not.toContain('inventory')
    expect(labels).not.toContain('accounting')
    expect(
      PLANNED_DASHBOARD_SECTIONS.some((section) => section.increment === 'DASH.9')
    ).toBe(false)
  })
})
