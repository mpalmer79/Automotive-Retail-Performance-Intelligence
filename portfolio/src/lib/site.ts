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
   * all - the header, the platform sub-navigation, or the footer's primary
   * list. Governs the footer list and the test sweep, not the header.
   */
  readonly inPrimaryNav: boolean
  /** Whether search engines may index it. */
  readonly indexable: boolean
  /** Sitemap priority. */
  readonly priority: number
}

/**
 * WHERE `/dealerships` WENT
 * -------------------------
 * It is not in this map because it is not a page. The group overview it used to
 * render IS the home page now, and `/dealerships` is a permanent redirect to `/`
 * declared in `next.config.ts`.
 *
 * Deliberately not left here as an entry pointing at `/`. A route map that
 * declares two hrefs for one document produces two sitemap URLs, two canonical
 * candidates and two navigation items for the same content, which is the
 * duplication the redirect exists to prevent. The three store routes beneath it
 * are unaffected and stay exactly where they were.
 */
export const ROUTES = {
  home: {
    href: '/',
    navLabel: 'Overview',
    title: 'Automotive Retail Performance Intelligence',
    /*
     * THE WORD "FICTIONAL" IS IN THE FIRST CLAUSE, AND THAT IS DELIBERATE.
     *
     * This string is the home page's meta description, which means it is the
     * text under the link when the site is shared on LinkedIn or returned by a
     * search engine. The previous version opened "Granite Auto Group runs three
     * dealerships..." - true on the site, where the group is declared fictional
     * six times, and misleading in a preview card read on its own, where it
     * reads as a real dealer group and ARPI as its vendor.
     *
     * A disclosure that only holds inside its own page is not a disclosure. It
     * has to survive being quoted.
     */
    description:
      'A portfolio data platform for Granite Auto Group, a fictional three-store dealer group: a Chevrolet franchise, a Subaru franchise and an independent pre-owned center. Seeded synthetic data in Python, a PostgreSQL warehouse, a governed KPI catalogue and a source-controlled Power BI model.',
    inPrimaryNav: true,
    indexable: true,
    priority: 1,
  },
  graniteChevrolet: {
    href: '/dealerships/granite-chevrolet',
    navLabel: 'Granite Chevrolet',
    title: 'Granite Chevrolet of Nashua',
    description:
      'The volume franchise rooftop of Granite Auto Group. New Chevrolet trucks and utilities arriving on manufacturer allocation, a small pre-owned presence beside them, and the inventory profile that sanitized reference data actually supports.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.7,
  },
  graniteSubaru: {
    href: '/dealerships/granite-subaru',
    navLabel: 'Granite Subaru',
    title: 'Granite Subaru of Manchester',
    description:
      'The all-weather franchise rooftop of Granite Auto Group. A narrow new-vehicle line, a materially larger pre-owned share than the Chevrolet store, and a partial reference sample that says so.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.7,
  },
  granitePreOwned: {
    href: '/dealerships/granite-pre-owned',
    navLabel: 'Granite Pre-Owned',
    title: 'Granite Pre-Owned Center of Merrimack',
    description:
      'The independent store of Granite Auto Group. No franchise, no allocation, every unit bought rather than shipped, and the widest multi-brand model-year and price spread in the group.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.7,
  },
  inventory: {
    href: '/inventory',
    navLabel: 'Inventory',
    title: 'Inventory explorer',
    description:
      'Every sanitized inventory listing Granite Auto Group carries, filterable by store, condition, make, model, model year, price and mileage. Derived at build time from the reference workbooks in the repository, never fetched or invented.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
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
      'Dealership intelligence built by someone who has run the dealership. Michael Palmer: more than 25 years in automotive retail sales, finance, dealership management, CRM, DMS and inventory, then computer science retraining and the engineering behind ARPI.',
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
  /*
   * THE CONSOLE.
   *
   * `/dashboard` is the ARPI Dealer Operations Command Center, admitted by
   * ADR-0013 under fifteen binding conditions and delivered by the `DASH.*`
   * increments. It is the only dashboard route that exists today: the nine
   * others in `INFORMATION_ARCHITECTURE.md` §1 arrive with the increments that
   * own them, and a route entry here for a page that does not exist would put a
   * dead link in the footer, the sitemap and the navigation sweep.
   *
   * `indexable`, deliberately. The console renders published, reconciled,
   * synthetic figures and states its own provenance in the page body; there is
   * nothing here that a crawler may not read, and the alternative - a noindex
   * flagship - would say the opposite of what the trust panel says.
   */
  dashboard: {
    href: '/dashboard',
    navLabel: 'Dashboard',
    title: 'Dealer Operations Command Center',
    description:
      'The ARPI operating console: group and store performance from the governed SQL export: retail units, gross and per-unit gross, inventory risk, the lead funnel, and the evidence behind every figure. Synthetic data for a fictional dealer group.',
    inPrimaryNav: true,
    indexable: true,
    priority: 0.9,
  },
  /*
   * `DASH.3` adds the two routes below. Both are real destinations with real
   * content, which is the only reason they may appear in `DASHBOARD_NAV`.
   *
   * Neither is in `PRIMARY_NAV`: the header already carries `Dashboard`, and the
   * console's own navigation is where its sections belong. `MAX_PRIMARY_NAV_ITEMS`
   * is a cap on how many destinations a reader is asked to choose between at the
   * top level, and a console section is not a top-level destination.
   */
  dashboardSalesGross: {
    href: '/dashboard/sales-gross',
    navLabel: 'Sales and gross',
    title: 'Sales and gross',
    description:
      'Volume, gross and per-unit gross across the group and by store, with the trend, the new and used mix, discount against asking price, the deal-level gross distribution, and the documented decomposition of what changed month over month. Synthetic data for a fictional dealer group.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.8,
  },
  dashboardDeals: {
    href: '/dashboard/deals',
    navLabel: 'Deal Explorer',
    title: 'Deal Explorer',
    description:
      'Every finalized transaction in the governed export, searchable by deal, unit, make and model, filterable by period, store, condition, sale type and lead source. Synthetic data for a fictional dealer group.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.8,
  },
  /*
   * `DASH.7` adds the F&I performance surface. `DASH.6` built the domain in SQL and
   * exported none of it; this is the route that reads it.
   */
  dashboardFi: {
    href: '/dashboard/fi',
    navLabel: 'F&I',
    title: 'F&I performance',
    description:
      'Finance reserve against product gross, product penetration on its own eligible denominator, category economics, cancellations and chargebacks on their own posting dates, and a finance-manager comparison under the minimum-sample rule. Synthetic data; every lender, product and provider is invented.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.8,
  },
  /*
   * `DASH.9` adds the two operating surfaces over the inventory and accounting domains.
   * `DASH.8` built the accounting domain in SQL and exported none of it; the export
   * promotion and these two routes are what make it readable.
   *
   * They sit after `dashboardFi` because that is the order the console's navigation
   * follows, and the order a reader works in: sales and gross, then the deals behind them,
   * then the stock those deals came out of, then the F&I attached to them, then whether
   * the books agree with any of it.
   */
  dashboardInventory: {
    href: '/dashboard/inventory',
    navLabel: 'Inventory',
    title: 'Inventory operations',
    description:
      'Unit-level stock at a governed snapshot date: age against a project-default threshold, the five governed age buckets, asking price against a synthetic market estimate, snapshot-derived price movement, and drill-through to one unit with its accounting position. The market estimate is synthetic, not a valuation.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.8,
  },
  dashboardAccounting: {
    href: '/dashboard/accounting',
    navLabel: 'Accounting',
    title: 'Accounting integrity',
    description:
      'The inventory subledger against selected synthetic GL control accounts: the signed variance, the four comparison states with missing sides preserved as missing, and the governed accounting exceptions with drill-through. An inventory control reconciliation, not a general ledger. Every account is invented.',
    inPrimaryNav: false,
    indexable: true,
    priority: 0.8,
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
  /*
   * "Dealerships" is NOT a separate item, and that is the point of this change.
   *
   * It used to be, pointing at `/dealerships`. The group overview is now the
   * home page, so a "Dealerships" item would be a second header link to the same
   * document as "Overview" - two names for one URL, which reads as two
   * destinations and is the duplication this restructure exists to remove.
   *
   * The stores are still one click from anywhere. The home page's own store
   * cards link each of them, `<GroupNav>` carries all three on every store page
   * and on the inventory explorer, and the mobile drawer expands the group in
   * full. What is gone is a redundant header entry, not a route.
   */
  /*
   * The seventh item, and the last one this header will take.
   *
   * `MAX_PRIMARY_NAV_ITEMS` is 7 and this reaches it exactly, which is why the
   * console's own ten destinations live in `DASHBOARD_NAV` on the page rather
   * than in the header: the public site gains one destination, not an
   * application menu. `matches` covers the whole `/dashboard` family so the
   * header marks Dashboard current on every console route as they land.
   *
   * Placed second, ahead of Inventory: it is the product this project builds
   * toward, and burying it after four documentation destinations would make the
   * header disagree with what the site is for.
   */
  {
    href: ROUTES.dashboard.href,
    label: 'Dashboard',
    matches: [ROUTES.dashboard.href],
    purpose: 'The operating console: units, gross, inventory risk and the funnel',
  },
  {
    href: ROUTES.inventory.href,
    label: 'Inventory',
    matches: [ROUTES.inventory.href],
    purpose: 'Every sanitized listing, filterable and sortable',
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
export const MAX_PRIMARY_NAV_ITEMS = 7

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

/**
 * The console's internal navigation.
 *
 * ONLY IMPLEMENTED DESTINATIONS APPEAR HERE, and today that is one.
 * `INFORMATION_ARCHITECTURE.md` §1 lists ten console routes; nine of them arrive
 * with the increments that own them, and listing them now would put nine dead
 * links into the navigation sweep, the sitemap and a reader's expectations. The
 * planned sections are named on the page instead, as text, beside the increment
 * that delivers each — a roadmap a reader can read is not a menu a reader can
 * click, and conflating the two is how a portfolio starts promising features.
 *
 * `DashboardNav` grows as they land. The rendering follows `PlatformNav`: a
 * `<nav>` of plain links with `aria-current`, explicitly not `role="tablist"`,
 * because it navigates between documents rather than switching panels inside one.
 */
export const DASHBOARD_NAV: readonly NavItem[] = [
  {
    href: ROUTES.dashboard.href,
    label: 'Command center',
    matches: [ROUTES.dashboard.href],
    purpose: 'Group and store operating performance on one screen',
  },
  {
    href: ROUTES.dashboardSalesGross.href,
    label: 'Sales and gross',
    matches: [ROUTES.dashboardSalesGross.href],
    purpose: 'Volume, gross, mix, discount and what changed',
  },
  {
    /*
     * `matchPrefixes` covers the Deal Jacket, so a reader on
     * `/dashboard/deals/SLE-00000123` sees the section they are inside marked
     * current. The Jacket is a drill-through, not a sibling: it is deliberately
     * NOT its own navigation item, because nothing navigates to "a deal" -- one
     * arrives at a specific deal from the index.
     */
    href: ROUTES.dashboardDeals.href,
    label: 'Deal Explorer',
    matches: [ROUTES.dashboardDeals.href],
    matchPrefixes: [`${ROUTES.dashboardDeals.href}/`],
    purpose: 'Every finalized transaction behind the numbers',
  },
  {
    /*
     * `DASH.7`. The Deal Jacket is deliberately NOT matched here even though it now
     * itemizes F&I: a reader who drilled from the Deal Explorer into one transaction
     * is inside Deals, and marking F&I current would tell them they navigated
     * somewhere they did not.
     */
    href: ROUTES.dashboardFi.href,
    label: 'F&I',
    matches: [ROUTES.dashboardFi.href],
    purpose: 'Reserve against product gross, penetration on eligible denominators',
  },
  {
    /*
     * `DASH.9`. Unit detail is a query parameter on this route rather than a child path,
     * so `matches` alone is right and no prefix is needed: `?unit=VEH-0000013` is the same
     * document with one panel open, and a reader who opens it has not navigated away.
     */
    href: ROUTES.dashboardInventory.href,
    label: 'Inventory',
    matches: [ROUTES.dashboardInventory.href],
    purpose:
      'Unit-level age, price against a synthetic estimate, and stock drill-through',
  },
  {
    href: ROUTES.dashboardAccounting.href,
    label: 'Accounting',
    matches: [ROUTES.dashboardAccounting.href],
    purpose: 'The subledger against GL controls, and the variances between them',
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
 * Rendered as text on `/dashboard`, never as links. Each names its increment so a
 * reader can check the claim against `docs/requirements/DASHBOARD_BACKLOG.md`
 * rather than take "coming soon" on trust — and so that this list cannot quietly
 * outlive the work it describes.
 */
export const PLANNED_DASHBOARD_SECTIONS: readonly PlannedDashboardSection[] = [
  {
    label: 'Deal Jacket',
    increment: 'DASH.4',
    purpose: 'One sanitized deal end to end, with its lineage',
  },
  {
    label: 'Leads and marketing',
    increment: 'DASH.10',
    purpose: 'Source quality, campaign cost and lost-stage analysis',
  },
  {
    label: 'Employee performance',
    increment: 'DASH.11',
    purpose: 'Role-aware views with minimum-sample discipline',
  },
  {
    label: 'Management actions',
    increment: 'DASH.12',
    purpose: 'A deterministic action queue with evidence and drill-through',
  },
]

/**
 * The Granite Auto Group sub-navigation.
 *
 * Rendered by `/dealerships`, the three store pages and `/inventory`, which is
 * what makes "Dealerships" a destination group rather than a link to one page.
 * Ordered as a reader takes them: the group first, then each store, then the
 * inventory those stores hold.
 */
export const GROUP_NAV: readonly NavItem[] = [
  {
    href: ROUTES.home.href,
    label: 'The group',
    matches: [ROUTES.home.href],
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
    label: 'Inventory explorer',
    matches: [ROUTES.inventory.href],
    purpose: 'Every listing, filterable and sortable',
  },
]

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
