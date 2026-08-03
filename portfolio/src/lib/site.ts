/**
 * Site-level constants: the route map, the navigation, and the canonical origin.
 *
 * The route map is the single source for navigation, the sitemap, the
 * breadcrumb trail and the accessibility test sweep. Adding a route here adds it
 * to all four, and `tests/unit/site.test.ts` asserts none of them can drift.
 */
import { resolveIsPreview } from './flags'
import { resolveSiteUrl } from './site-url'

export const SITE_NAME = 'ARPI'
export const SITE_TITLE = 'Automotive Retail Performance Intelligence'
export const SITE_AUTHOR = 'Michael Palmer'

/**
 * The canonical origin, decided once for the whole build.
 *
 * Resolution is delegated to `lib/site-url.ts`, which is a pure function and is
 * tested along every path. On Railway the answer comes from the platform's own
 * `RAILWAY_PUBLIC_DOMAIN`, so a staging deployment needs no variable typed by a
 * person; locally it is `http://localhost:3000` and also needs none.
 *
 * Read at module scope rather than per request because all fourteen routes are
 * statically prerendered: there is no request in scope when the sitemap, the
 * canonical tags or the JSON-LD graph are produced, and deriving them from a
 * `Host` header instead would make them vary with an attacker-controlled header.
 */
const RESOLVED_SITE_URL = resolveSiteUrl(process.env)

export const SITE_URL = RESOLVED_SITE_URL.url

/** Which input decided {@link SITE_URL}. Read by the deployment verifier. */
export const SITE_URL_SOURCE = RESOLVED_SITE_URL.source

/** Inputs that were present but unusable. Empty on a correct deployment. */
export const SITE_URL_WARNINGS = RESOLVED_SITE_URL.warnings

/**
 * Whether this build is an unpublished deployment that must not be indexed.
 *
 * Three ways to be true, and the third is the important one:
 *
 *   - `VERCEL_ENV === 'preview'`            a Vercel branch preview
 *   - `NEXT_PUBLIC_ARPI_PREVIEW === 'true'` an explicit local or manual override
 *   - a Railway environment other than `production`
 *
 * The Railway rule is deliberately expressed as "anything that is not
 * production", not as "the environment named staging". No production deployment
 * of this site has been approved, so every deployment that currently exists is
 * an unpublished one, and a rule that had to name each new environment would
 * fail open the first time somebody added one. Failing closed here costs a
 * staging deployment nothing: it is not meant to be in a search index.
 *
 * Consequences of being true are in `robots.ts` (disallow all crawling),
 * `metadata.ts` (`noindex`, canonical tags on this deployment's own origin) and
 * `components/shell/preview-notice.tsx` (a marker a person can see).
 */
export const IS_PREVIEW = resolveIsPreview(process.env)

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
  /**
   * The route's own short label.
   *
   * NOT the primary-navigation label, which is a separate decision made in
   * {@link PRIMARY_NAV}. `/architecture` is labelled "Architecture" here, in the
   * footer and in its breadcrumb, and is reached from a primary navigation item
   * labelled "Platform" that also covers the data model and governance. A route
   * and a navigation entry are different things and conflating them is what
   * produced seven top-level destinations.
   */
  readonly navLabel: string
  /** Full page title, used in <title> and breadcrumbs. */
  readonly title: string
  readonly description: string
  /**
   * Whether the route is reachable from the site's own navigation surfaces at
   * all - the header, the platform sub-navigation, or the footer's primary
   * list. Governs the footer list and the test sweep, not the header.
   */
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
      'Dealership intelligence built by someone who has run the dealership. ARPI joins more than 25 years of automotive retail experience to PostgreSQL, Python, governed KPIs and Power BI architecture, giving sales, gross, inventory, leads and marketing one definition each. Synthetic data throughout.',
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
  inventoryOperations: {
    href: '/inventory-operations',
    navLabel: 'Inventory Operations',
    title: 'Inventory operations',
    description:
      'Ingesting a de-identified public inventory listing snapshot: what sanitization removes, what a listing can and cannot prove, the listing snapshot grain, six governed reporting views, and the Excel operating report built from them. The one part of ARPI that is not fully synthetic, and it says so.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.8,
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
      'Michael Palmer: more than 25 years in automotive retail sales, finance, dealership management, CRM, DMS and inventory, then computer science retraining and the SQL, Python and semantic modelling behind ARPI. Six design decisions that came from the floor rather than from a dataset.',
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

/** Routes reachable from the site's own navigation surfaces, in order. */
export const NAVIGABLE_ROUTES: readonly RouteDefinition[] = ALL_ROUTES.filter(
  (route) => route.inPrimaryNav
)

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

export interface NavItem {
  readonly href: string
  readonly label: string
  /**
   * The pathnames this item is the current one for.
   *
   * An explicit list rather than a prefix test. "Platform" is current on three
   * unrelated paths, and a prefix rule cannot express that; a prefix rule also
   * silently marks `/status` current for a future `/status-report`, which is the
   * kind of bug that only shows up after the route exists.
   */
  readonly matches: readonly string[]
  /** One line of purpose, shown in the mobile drawer. */
  readonly purpose: string
}

/**
 * THE PRIMARY NAVIGATION: five content destinations, plus GitHub.
 *
 * Down from seven. What changed and why, recorded in
 * EXPERIENCE_REDESIGN_V2.md section 3.1:
 *
 *   Architecture, Data Model and Governance  →  one item, "Platform"
 *
 *     Three peers competing for one click, of which Governance was the least
 *     likely first destination and Data Model the least self-explanatory.
 *     "Platform" points at `/architecture` and every one of the three renders
 *     `<PlatformNav>`, which links all three with `aria-current`. Both routes
 *     stay directly addressable, indexable and linked from the footer.
 *
 *     A disclosure menu in the header was rejected: it buys nothing over two
 *     links and costs a focus trap, an escape handler and a hover ambiguity. A
 *     new `/platform` overview route was rejected: its only content would be
 *     links to two better pages.
 *
 *   Case Study  →  out of the header entirely
 *
 *     It was the only bordered, filled control in the header, which made the
 *     emptiest page on the site its most prominent destination. It is still
 *     visible - the footer, the status page and the home page's closing section
 *     all carry it, all of them saying "locked" in words.
 *
 * The count is asserted by `tests/unit/site.test.ts` and by the content
 * integrity suite, so a sixth item cannot arrive without a decision.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  {
    href: ROUTES.home.href,
    label: 'Overview',
    matches: ['/'],
    purpose: 'What ARPI is, who built it, and what it proves',
  },
  {
    href: ROUTES.architecture.href,
    label: 'Platform',
    matches: [
      ROUTES.architecture.href,
      ROUTES.dataModel.href,
      ROUTES.inventoryOperations.href,
      ROUTES.governance.href,
    ],
    purpose: 'Architecture, the data model, inventory operations and how it is governed',
  },
  {
    href: ROUTES.kpis.href,
    label: 'KPIs',
    matches: [ROUTES.kpis.href],
    purpose: 'Every governed metric definition',
  },
  {
    href: ROUTES.status.href,
    label: 'Status',
    matches: [ROUTES.status.href],
    purpose: 'What is finished, what is pending, what is blocked',
  },
  {
    href: ROUTES.about.href,
    label: 'About',
    matches: [ROUTES.about.href],
    purpose: 'Twenty-five years in dealerships, then the engineering',
  },
]

/**
 * The ceiling on primary navigation, stated as a constant so the test that
 * enforces it reads as a rule rather than as a magic number.
 */
export const MAX_PRIMARY_NAV_ITEMS = 5

/**
 * The platform sub-navigation.
 *
 * Rendered by `/architecture`, `/data-model`, `/inventory-operations` and
 * `/governance`, which is what makes "Platform" a real destination group rather
 * than a relabelled link to one page. Ordered as a reader would take them: how
 * the data moves, what it becomes, what happens when something arrives from
 * outside, and the rules that hold all three.
 *
 * `/inventory-operations` sits inside the group rather than in the header for the
 * same reason the other three do: it is a platform capability, not a top-level
 * destination, and MAX_PRIMARY_NAV_ITEMS is a rule rather than a preference.
 */
export const PLATFORM_NAV: readonly NavItem[] = [
  {
    href: ROUTES.architecture.href,
    label: 'Architecture',
    matches: [ROUTES.architecture.href],
    purpose: 'How data travels from source systems to governed layers',
  },
  {
    href: ROUTES.dataModel.href,
    label: 'Data model',
    matches: [ROUTES.dataModel.href],
    purpose: 'Facts, dimensions, declared grains and history policies',
  },
  {
    href: ROUTES.inventoryOperations.href,
    label: 'Inventory operations',
    matches: [ROUTES.inventoryOperations.href],
    purpose: 'Ingesting a sanitized public listing snapshot end to end',
  },
  {
    href: ROUTES.governance.href,
    label: 'Governance',
    matches: [ROUTES.governance.href],
    purpose: 'Synthetic data, privacy, metric governance and the gates',
  },
]

/** Whether a navigation item is the current one for a pathname. */
export function isNavItemCurrent(item: NavItem, pathname: string): boolean {
  return item.matches.includes(pathname)
}

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
