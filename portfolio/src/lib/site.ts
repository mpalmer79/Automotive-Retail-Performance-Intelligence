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
 * Read at module scope rather than per request because all nineteen routes are
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
   * all - the operating rail, the reference header, the group sub-navigation or
   * the footer's index. Governs the footer list and the test sweep, not any one
   * navigation.
   *
   * `false` therefore means "exists, is indexed, and is reached from the body of
   * another page": the three store pages, the locked case study and the internal
   * lab.
   */
  readonly inPrimaryNav: boolean
  /** Whether search engines may index it. */
  readonly indexable: boolean
  /** Sitemap priority. */
  readonly priority: number
}

/**
 * THE ROUTE MAP AFTER `UX.1`
 * ---------------------------
 * Two information domains, and the map says which is which.
 *
 *   OPERATING   `/` and the seven `/dashboard/*` surfaces. What a dealership
 *               manager uses. Business language, governed figures, drill-through.
 *   REFERENCE   `/technical`, `/about`, `/inventory` and the three store pages.
 *               How the platform is built, who built it, and what the demo group
 *               is. A reader goes here deliberately.
 *
 * SIX ROUTES LEFT THIS MAP AND ARE NOT GONE. `/architecture`, `/data-model`,
 * `/kpis`, `/governance`, `/status` and `/inventory-operations` are permanent
 * redirects into `/technical?view=...`, declared in `next.config.ts`. They are
 * deliberately NOT left here as entries pointing at a query state: a route map
 * that declares two hrefs for one document produces two sitemap URLs, two
 * canonical candidates and two navigation items for the same content, which is
 * the duplication the redirects exist to prevent. `/dealerships` and
 * `/dashboard` are absent for the same reason and by the same mechanism.
 */
export const ROUTES = {
  /*
   * THE PRODUCT'S FRONT DOOR.
   *
   * `/` was a marketing landing page — hero, store story, product tour, closing
   * call to action — in front of a working operating console at `/dashboard`.
   * ADR-0015 makes the console the canonical entry experience and `/dashboard` a
   * permanent redirect here, query string preserved. The retired landing sections
   * were rehomed rather than deleted: the tour and the store story are
   * `/technical?view=overview`, the author positioning is `/about`.
   */
  home: {
    href: '/',
    navLabel: 'Executive',
    title: 'Executive Command Center',
    /*
     * THE WORD "FICTIONAL" IS IN THE FIRST CLAUSE, AND THAT IS DELIBERATE.
     *
     * This string is the home page's meta description, which means it is the
     * text under the link when the site is shared on LinkedIn or returned by a
     * search engine. A disclosure that only holds inside its own page is not a
     * disclosure; it has to survive being quoted.
     *
     * What changed at `UX.1` is what the sentence leads with. It led with the
     * pipeline — seeded Python, a PostgreSQL warehouse, a source-controlled
     * semantic model — which described how the thing was built to a reader who
     * had not yet been told what it does.
     */
    description:
      'One operating view of a dealer group: retail units, gross, inventory, F&I, demand and accounting integrity on a single screen, with drill-through to the transactions behind every figure. Granite Auto Group is a fictional three-store dealer group and every operating figure is synthetic.',
    inPrimaryNav: true,
    indexable: true,
    priority: 1,
  },
  dashboardSalesGross: {
    href: '/dashboard/sales-gross',
    navLabel: 'Sales & Gross',
    title: 'Sales and gross',
    description:
      'Volume, gross and per-unit gross across the group and by store, with the trend, the new and used mix, discount against asking price, the deal-level gross distribution, and the decomposition of what changed month over month. Synthetic data for a fictional dealer group.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
  },
  dashboardDeals: {
    href: '/dashboard/deals',
    navLabel: 'Deals',
    title: 'Deal Explorer',
    description:
      'Every finalized transaction in the governed export, searchable by deal, unit, make and model, filterable by period, store, condition, sale type and lead source. Synthetic data for a fictional dealer group.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
  },
  dashboardInventory: {
    href: '/dashboard/inventory',
    navLabel: 'Inventory',
    title: 'Inventory',
    description:
      'Unit-level stock at a governed snapshot date: age against a project-default threshold, the five governed age buckets, asking price against a synthetic market estimate, snapshot-derived price movement, and drill-through to one unit with its accounting position. The market estimate is synthetic, not a valuation.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
  },
  dashboardFi: {
    href: '/dashboard/fi',
    navLabel: 'F&I',
    title: 'F&I',
    description:
      'Finance reserve against product gross, product penetration on its own eligible denominator, category economics, cancellations and chargebacks on their own posting dates, and a finance-manager comparison under the minimum-sample rule. Synthetic data; every lender, product and provider is invented.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
  },
  dashboardLeadsMarketing: {
    href: '/dashboard/leads-marketing',
    navLabel: 'Leads & Marketing',
    title: 'Leads and marketing',
    description:
      'The BDC and marketing surface: the lead-created cohort funnel, appointment outcomes on their own two date bases, first-response times with the leads nobody answered beside them, where the cohort stopped, and spend against attributed outcomes. Synthetic data for a fictional dealer group.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
  },
  dashboardEmployees: {
    href: '/dashboard/employees',
    navLabel: 'Employees',
    title: 'Employees',
    description:
      'Role-aware views of what was credited to each synthetic employee: units and gross, desked deliveries, finance structure, and the BDC lead funnel. Every comparative figure carries its own governed denominator and is withheld below the minimum sample. No ranking, no score, no personnel data.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
  },
  dashboardAccounting: {
    href: '/dashboard/accounting',
    navLabel: 'Accounting',
    title: 'Accounting',
    description:
      'The inventory subledger against selected synthetic GL control accounts: the signed variance, the four comparison states with missing sides preserved as missing, and the governed accounting exceptions with drill-through. An inventory control reconciliation, not a general ledger. Every account is invented.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
  },
  /*
   * THE ONE TECHNICAL DESTINATION.
   *
   * `UX.1` consolidated six routes into this one, addressed by `?view=`. The
   * views are declared in `lib/technical.ts`, which owns the mapping from a view
   * to the legacy route it replaced; the redirects are in `next.config.ts`.
   */
  technical: {
    href: '/technical',
    navLabel: 'Technical',
    title: 'How ARPI works',
    description:
      'The engineering behind the operating application: the pipeline, the dimensional model, the governed KPI catalogue, privacy and reconciliation controls, the data sources, the delivery status, and the production vision for authorized dealership system integrations.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.8,
  },
  about: {
    href: '/about',
    navLabel: 'About',
    title: 'About the author',
    description:
      'Dealership intelligence built by someone who has run the dealership. Michael Palmer: more than 25 years in automotive retail sales, finance, dealership management, CRM, DMS and inventory, then computer science retraining and the engineering behind ARPI.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.7,
  },
  /*
   * THE REFERENCE LISTING EXPLORER, AND WHY IT IS NO LONGER CALLED "INVENTORY".
   *
   * There were two destinations named Inventory. `/dashboard/inventory` is the
   * operating surface: synthetic units, age, capital, price movement, accounting
   * position, drill-through. This one is a de-identified snapshot of what a public
   * listing source exposed — listings, not sales results, not an operating
   * position. A general manager who has to choose between two things both called
   * Inventory has been handed the ambiguity instead of an answer.
   *
   * `UX.1` resolves it by NAME AND BY PLACEMENT rather than by moving the URL.
   * Inventory in the operating navigation now means the operating surface and
   * nothing else; this route is labelled "Reference listings", is reached from
   * `/technical?view=data-sources`, and is not in the operating rail at all. The
   * URL is unchanged, so every deep link into it — and its own `make`, `model`,
   * `year`, `price` and `sort` grammar, which is not the console's grammar — keeps
   * working exactly as it did.
   */
  inventory: {
    href: '/inventory',
    navLabel: 'Reference listings',
    title: 'Reference listing explorer',
    description:
      'Every sanitized public inventory listing in the reference workbooks, filterable by store, condition, make, model, model year, price and mileage. De-identified listing attributes captured from a public source, not a dealer management system export and not an operating inventory position.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.6,
  },
  graniteChevrolet: {
    href: '/dealerships/granite-chevrolet',
    navLabel: 'Granite Chevrolet',
    title: 'Granite Chevrolet of Nashua',
    description:
      'The volume franchise rooftop of Granite Auto Group, a fictional dealer group. New Chevrolet trucks and utilities arriving on manufacturer allocation, a small pre-owned presence beside them, and the inventory profile that sanitized reference data actually supports.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.5,
  },
  graniteSubaru: {
    href: '/dealerships/granite-subaru',
    navLabel: 'Granite Subaru',
    title: 'Granite Subaru of Manchester',
    description:
      'The all-weather franchise rooftop of Granite Auto Group, a fictional dealer group. A narrow new-vehicle line, a materially larger pre-owned share than the Chevrolet store, and a partial reference sample that says so.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.5,
  },
  granitePreOwned: {
    href: '/dealerships/granite-pre-owned',
    navLabel: 'Granite Pre-Owned',
    title: 'Granite Pre-Owned Center of Merrimack',
    description:
      'The independent store of Granite Auto Group, a fictional dealer group. No franchise, no allocation, every unit bought rather than shipped, and the widest multi-brand model-year and price spread in the group.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.5,
  },
  caseStudy: {
    href: '/case-study',
    navLabel: 'Case Study',
    title: 'Case study',
    description:
      'The public analytical case study for ARPI. Held closed by Gate 2 until report pages are complete, SQL and Power BI totals reconcile, and executive findings are drafted.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.4,
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
  /**
   * Path prefixes this item is ALSO current for.
   *
   * For a drill-through: a route that belongs inside a section but is not a
   * navigation destination of its own, because nobody navigates to "a deal" — they
   * arrive at one specific deal from the index. `/dashboard/deals/SLE-00000123` has
   * to mark Deal Explorer current, and there are 650 of them, so an exact list is
   * not available.
   *
   * Each prefix must end in `/`. That is what keeps this from becoming the blanket
   * prefix rule `matches` exists to avoid: `/dashboard/deals/` cannot silently claim
   * a future `/dashboard/deals-report`, which is exactly the bug that only shows up
   * once the second route exists. `tests/unit/site.test.ts` asserts the trailing
   * slash on every prefix.
   */
  readonly matchPrefixes?: readonly string[]
  /** One line of purpose, shown in the mobile drawer. */
  readonly purpose: string
}

/**
 * THE OPERATING NAVIGATION — the application rail.
 *
 * Eight destinations, in the order a manager works: the group result, the volume
 * and gross behind it, the transactions behind that, the stock those transactions
 * came out of, the F&I attached to them, the demand that produced them, the people
 * credited with them, and whether the books agree with any of it.
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *
 *   Actions        `DASH.12`. There is no action queue, so there is no link to
 *                  one. A navigation item for an unbuilt route is a promise, and
 *                  `PLANNED_DASHBOARD_SECTIONS` states it as text instead.
 *   Technical      A utility destination, not an operating one. It is in
 *                  {@link UTILITY_NAV}, rendered apart from the rail.
 *   Reference listings
 *                  `/inventory` is sanitized public listing data. Putting it in
 *                  the rail beside `/dashboard/inventory` is what created two
 *                  destinations called Inventory; see the route comment there.
 *
 * `matchPrefixes` covers the Deal Jacket, which is a drill-through rather than a
 * sibling: nobody navigates to "a deal", they arrive at one specific deal from the
 * index, and there are 650 of them so an exact list is not available.
 */
export const OPERATING_NAV: readonly NavItem[] = [
  {
    href: ROUTES.home.href,
    label: 'Executive',
    matches: [ROUTES.home.href],
    purpose: 'The group on one screen: result, pace, stock, demand, integrity',
  },
  {
    href: ROUTES.dashboardSalesGross.href,
    label: 'Sales & Gross',
    matches: [ROUTES.dashboardSalesGross.href],
    purpose: 'Volume, gross, mix, discount and what changed',
  },
  {
    href: ROUTES.dashboardDeals.href,
    label: 'Deals',
    matches: [ROUTES.dashboardDeals.href],
    matchPrefixes: [`${ROUTES.dashboardDeals.href}/`],
    purpose: 'Every finalized transaction behind the numbers',
  },
  {
    href: ROUTES.dashboardInventory.href,
    label: 'Inventory',
    matches: [ROUTES.dashboardInventory.href],
    purpose: 'Age, capital tied up, price position and unit drill-through',
  },
  {
    href: ROUTES.dashboardFi.href,
    label: 'F&I',
    matches: [ROUTES.dashboardFi.href],
    purpose: 'Reserve against product gross, penetration on eligible denominators',
  },
  {
    href: ROUTES.dashboardLeadsMarketing.href,
    label: 'Leads & Marketing',
    matches: [ROUTES.dashboardLeadsMarketing.href],
    purpose: 'Funnel, response time, where the cohort stopped, and spend',
  },
  {
    href: ROUTES.dashboardEmployees.href,
    label: 'Employees',
    matches: [ROUTES.dashboardEmployees.href],
    purpose: 'Role-aware activity with its own denominators and sample discipline',
  },
  {
    href: ROUTES.dashboardAccounting.href,
    label: 'Accounting',
    matches: [ROUTES.dashboardAccounting.href],
    purpose: 'The subledger against GL controls, and the variances between them',
  },
]

/**
 * The utility destinations, rendered at the foot of the rail and in the drawer.
 *
 * They leave the operating application. That is the point of separating them: a
 * manager reading gross is not choosing between "Inventory" and "Governance", and
 * a header that offers both as equal choices is a portfolio's table of contents
 * wearing an application's clothes.
 */
export const UTILITY_NAV: readonly NavItem[] = [
  {
    href: ROUTES.technical.href,
    label: 'Technical',
    matches: [ROUTES.technical.href],
    purpose: 'How ARPI is built, governed, sourced and validated',
  },
  {
    href: ROUTES.about.href,
    label: 'About',
    matches: [ROUTES.about.href],
    purpose: 'Twenty-five years in dealerships, then the engineering',
  },
]

/**
 * The reference domain's own header navigation.
 *
 * Three items. `Executive` is first and returns to the operating application,
 * because every one of these routes is somewhere a reader arrived at FROM the
 * application and needs a way back out of.
 *
 * It is still called `PRIMARY_NAV` because it is still what `<SiteHeader>`
 * renders and what the navigation sweep and the item cap are asserted against;
 * what changed is that it is no longer the whole site's navigation, because the
 * operating half of the site now has a rail of its own.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  {
    href: ROUTES.home.href,
    label: 'Executive',
    matches: [ROUTES.home.href],
    purpose: 'Back to the operating application',
  },
  ...UTILITY_NAV,
]

/**
 * The ceiling on primary navigation, stated as a constant so the test that
 * enforces it reads as a rule rather than as a magic number.
 */
export const MAX_PRIMARY_NAV_ITEMS = 7

/**
 * The Granite Auto Group sub-navigation.
 *
 * Rendered by the three store routes and by the reference listing explorer. It is
 * DEMO-BUSINESS CONTEXT, not an operating destination group: store selection in the
 * operating application happens through the `store` filter, and nobody should have
 * to navigate to a separate page to pick a rooftop. `UX.1` retargets its first
 * entry from `/` — which is now the operating console — to the group context that
 * actually describes the three stores.
 */
export const GROUP_NAV: readonly NavItem[] = [
  {
    href: `${ROUTES.technical.href}?view=overview`,
    label: 'The group',
    matches: [ROUTES.technical.href],
    purpose: 'Three stores, three operating models, one reporting layer',
  },
  {
    href: ROUTES.graniteChevrolet.href,
    label: 'Granite Chevrolet',
    matches: [ROUTES.graniteChevrolet.href],
    purpose: 'The franchise volume store in Nashua',
  },
  {
    href: ROUTES.graniteSubaru.href,
    label: 'Granite Subaru',
    matches: [ROUTES.graniteSubaru.href],
    purpose: 'The all-weather franchise in Manchester',
  },
  {
    href: ROUTES.granitePreOwned.href,
    label: 'Granite Pre-Owned',
    matches: [ROUTES.granitePreOwned.href],
    purpose: 'The independent pre-owned center in Merrimack',
  },
  {
    href: ROUTES.inventory.href,
    label: 'Reference listings',
    matches: [ROUTES.inventory.href],
    purpose: 'Sanitized public listing data, filterable and sortable',
  },
]

/** A console section that does not exist yet, and the increment that delivers it. */
export interface PlannedDashboardSection {
  readonly label: string
  /** The delivery increment, so the claim is checkable against the backlog. */
  readonly increment: string
  readonly purpose: string
}

/**
 * The console sections that are not built.
 *
 * Rendered as text, never as links. Each names its increment so a reader can check
 * the claim against `docs/requirements/DASHBOARD_BACKLOG.md` rather than take
 * "coming soon" on trust — and so that this list cannot quietly outlive the work it
 * describes. `site.test.ts` fails if a planned label names a route the application
 * can already navigate to.
 */
export const PLANNED_DASHBOARD_SECTIONS: readonly PlannedDashboardSection[] = [
  {
    label: 'Management actions',
    increment: 'DASH.12',
    purpose: 'A deterministic action queue with evidence and drill-through',
  },
]

/**
 * The operating application's pathnames, derived from the rail rather than typed.
 *
 * The rail is the definition of what "the operating application" means, so the
 * shell, the filter-carrying link helper and the copy guard all read it from one
 * place. A ninth operating route that arrives without joining the rail is not an
 * operating route; a ninth rail entry is one automatically.
 */
export const OPERATING_ROUTE_HREFS: readonly string[] = OPERATING_NAV.map(
  (item) => item.href
)

/**
 * Whether a pathname is inside the operating application.
 *
 * The Deal Jacket is: `/dashboard/deals/SLE-00000646` is a drill-through from an
 * operating route and wears the operating shell. Nothing under `/technical`,
 * `/about`, `/inventory` or `/dealerships` is.
 */
export function isOperatingRoute(pathname: string): boolean {
  if (OPERATING_ROUTE_HREFS.includes(pathname)) return true
  return OPERATING_NAV.some((item) =>
    (item.matchPrefixes ?? []).some((prefix) => pathname.startsWith(prefix))
  )
}

/** Whether a navigation item is the current one for a pathname. */
export function isNavItemCurrent(item: NavItem, pathname: string): boolean {
  if (item.matches.includes(pathname)) return true
  return (item.matchPrefixes ?? []).some((prefix) => pathname.startsWith(prefix))
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
  'Every warehouse record in this project is synthetic. Granite Auto Group and its three stores are fictional. No real dealership, customer, employee or lending data exists anywhere in the project.'

/** The short form, for space-constrained placements. */
export const SYNTHETIC_DATA_SHORT = 'Synthetic data. Granite Auto Group is fictional.'

/**
 * The operating application's compact demo statement.
 *
 * ONE STATEMENT, ONCE PER SCREEN, IN THE SHELL. `UX.1` replaced a per-route trust
 * line, three status badges in the executive header and a repeated provenance
 * paragraph with this single line in the top bar, which activates the same
 * methodology disclosure the figures link to. The full statement above is
 * unchanged, is still rendered on every operating route inside that disclosure,
 * and `content-integrity` still asserts it route by route: what was reduced is
 * repetition, not disclosure.
 *
 * Written from the reader's side of the screen. "Every warehouse record in this
 * project is synthetic" is a sentence about a repository; a manager looking at a
 * gross figure needs to know that the dealer group is invented and the figure is
 * not a real result.
 */
export const SYNTHETIC_DEMO_SHORT =
  'Granite Auto Group is fictional. Operating figures are synthetic.'

/**
 * The inventory disclosure, and why it is a SECOND statement rather than a
 * clause added to the first one.
 *
 * The warehouse data and the inventory data have different provenance, and
 * collapsing them into one sentence would misdescribe both. The warehouse is
 * machine-generated from a seed: no row of it was ever observed anywhere. The
 * inventory reference files are not that. They are vehicle attributes captured
 * from a public listing source, de-identified, stripped of every real dealership
 * identity, and reassigned to a fictional store. Calling that "synthetic" would
 * claim more sanitization than was performed; calling the warehouse "sanitized"
 * would claim less.
 *
 * Every route that renders an inventory figure carries this line as well as the
 * one above, and the content-integrity suite asserts it.
 */
export const INVENTORY_DATA_STATEMENT =
  'The inventory shown on this site is sanitized public reference data, not a dealer management system export and not machine-generated. Real VINs, source URLs, listing keys, street addresses and real dealership identity were removed before the workbooks entered this repository; the vehicle attributes that remain are a de-identified snapshot of what a public listing source exposed. Every row describes a listing that was visible at capture time. None of them describes a sale, a delivery, a gross figure or a dealership result.'

/** The short form of the inventory disclosure. */
export const INVENTORY_DATA_SHORT =
  'Sanitized public reference data. Listings, not sales results.'
