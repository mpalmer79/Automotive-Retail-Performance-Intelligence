/**
 * Site-level constants: the route map, the navigation, and the canonical origin.
 *
 * The route map is the single source for navigation, the sitemap, the
 * breadcrumb trail and the accessibility test sweep. Adding a route here adds it
 * to all four, and `tests/unit/site.test.ts` asserts none of them can drift.
 */

export const SITE_NAME = 'ARPI'
export const SITE_TITLE = 'Automotive Retail Performance Intelligence'
export const SITE_AUTHOR = 'Michael Palmer'

/**
 * The canonical origin. `NEXT_PUBLIC_SITE_URL` is set per deployment; a preview
 * deployment sets its own so that canonical tags do not point an unstable
 * preview at a production URL it is not.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
).replace(/\/+$/, '')

/**
 * Whether this build is an unstable preview. A preview must not be indexed, and
 * `robots.ts` reads this.
 */
export const IS_PREVIEW =
  process.env.VERCEL_ENV === 'preview' || process.env.NEXT_PUBLIC_ARPI_PREVIEW === 'true'

export const REPOSITORY_URL =
  'https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence'

/** Build a link to a file in the repository at the default branch. */
export function repoFileUrl(path: string): string {
  const clean = path.replace(/^\/+/, '')
  // A trailing slash means a directory; GitHub needs `tree` rather than `blob`.
  const kind = clean.endsWith('/') ? 'tree' : 'blob'
  return `${REPOSITORY_URL}/${kind}/main/${clean.replace(/\/+$/, '')}`
}

export interface RouteDefinition {
  readonly href: string
  /** Short label for primary navigation. */
  readonly navLabel: string
  /** Full page title, used in <title> and breadcrumbs. */
  readonly title: string
  readonly description: string
  /** Whether the route appears in primary navigation. */
  readonly inPrimaryNav: boolean
  /** Whether search engines may index it. */
  readonly indexable: boolean
  /** Sitemap priority. */
  readonly priority: number
}

export const ROUTES = {
  home: {
    href: '/',
    navLabel: 'Overview',
    title: 'Automotive Retail Performance Intelligence',
    description:
      'One governed view of dealership performance. A synthetic, reproducible automotive retail analytics platform built on PostgreSQL and a source-controlled Power BI semantic model.',
    inPrimaryNav: true,
    indexable: true,
    priority: 1,
  },
  architecture: {
    href: '/architecture',
    navLabel: 'Architecture',
    title: 'Architecture',
    description:
      'An interactive explorer of the ARPI pipeline: seeded Python generation, in-memory validation, the raw, staging, warehouse, reporting and audit schemas, and the source-controlled semantic model above them.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
  },
  dataModel: {
    href: '/data-model',
    navLabel: 'Data Model',
    title: 'Data model',
    description:
      'The eight conformed dimensions and five facts of the ARPI warehouse, each with its declared grain, its keys, its history policy and its privacy classification.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
  },
  kpis: {
    href: '/kpis',
    navLabel: 'KPIs',
    title: 'KPI catalogue',
    description:
      'Every governed KPI in ARPI with its formula, explicit numerator and denominator, grain, date basis, null rule, source reporting view and interpretation caution. Searchable and filterable.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
  },
  governance: {
    href: '/governance',
    navLabel: 'Governance',
    title: 'Governance and privacy',
    description:
      'How ARPI keeps its numbers honest: synthetic-only data, no PII by construction, declared grains, documented lineage, reconciliation, a read-only reporting role, and scope gates that block work rather than describe it.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.8,
  },
  status: {
    href: '/status',
    navLabel: 'Status',
    title: 'Project status',
    description:
      'The current state of every lifecycle phase and delivery increment, the two scope gates, and both real-engine semantic-model validation paths, derived from source-controlled evidence.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.8,
  },
  about: {
    href: '/about',
    navLabel: 'About',
    title: 'About the author',
    description:
      'Michael Palmer: more than 25 years in automotive retail, and the technical work behind ARPI. Why a project like this needs someone who has worked the floor.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.7,
  },
  caseStudy: {
    href: '/case-study',
    navLabel: 'Case Study',
    title: 'Case study',
    description:
      'The public analytical case study for ARPI. Held closed by Gate 2 until report pages are complete, SQL and Power BI totals reconcile, and executive findings are drafted.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.6,
  },
  uiLab: {
    href: '/ui-lab',
    navLabel: 'UI lab',
    title: 'UI lab',
    description:
      'An internal reference for the ARPI design system. Not a user-facing feature.',
    inPrimaryNav: false,
    indexable: false,
    priority: 0.1,
  },
} as const satisfies Record<string, RouteDefinition>

export type RouteKey = keyof typeof ROUTES

/** Every route, in navigation and sitemap order. */
export const ALL_ROUTES: readonly RouteDefinition[] = Object.values(ROUTES)

/** Routes that appear in the primary navigation, in order. */
export const PRIMARY_NAV: readonly RouteDefinition[] = ALL_ROUTES.filter(
  (route) => route.inPrimaryNav
)

/** Routes a search engine may index. */
export const INDEXABLE_ROUTES: readonly RouteDefinition[] = ALL_ROUTES.filter(
  (route) => route.indexable
)

/** Look up a route definition by pathname. Exact match only. */
export function routeByHref(href: string): RouteDefinition | undefined {
  return ALL_ROUTES.find((route) => route.href === href)
}

/**
 * The synthetic-data statement. Every primary route renders this string, and
 * `tests/e2e/content-integrity.spec.ts` asserts it is present on each one, so
 * the disclosure cannot end up living only in the footer.
 */
export const SYNTHETIC_DATA_STATEMENT =
  'Every record in this project is synthetic. Granite State Auto Group and its three stores are fictional. No real dealership, customer, employee or lending data exists anywhere in the project.'

/** The short form, for space-constrained placements. */
export const SYNTHETIC_DATA_SHORT =
  'Synthetic data. Granite State Auto Group is fictional.'
