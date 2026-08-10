/**
 * The route list the end-to-end suites sweep.
 *
 * Duplicated from `src/lib/site.ts` deliberately: importing the app's own route
 * map would mean a route deleted from the map silently disappears from the test
 * sweep as well, and the suite would go green while covering less. An
 * independent list is a second opinion, and `tests/e2e/navigation.spec.ts`
 * asserts the two agree.
 */
export interface RouteUnderTest {
  readonly path: string
  /** The expected h1, as a substring. */
  readonly heading: string
  /** Whether the route appears in the primary navigation. */
  readonly inNav: boolean
  /** The primary-navigation label, where it has one. */
  readonly navLabel?: string
}

export const PRIMARY_ROUTES: readonly RouteUnderTest[] = [
  {
    path: '/',
    heading: 'Three dealerships. Three operating models. One governed reporting layer.',
    inNav: true,
    navLabel: 'Overview',
  },
  {
    path: '/dealerships/granite-chevrolet',
    heading: 'Granite Chevrolet of Nashua',
    inNav: false,
    navLabel: 'Granite Chevrolet',
  },
  {
    path: '/dealerships/granite-subaru',
    heading: 'Granite Subaru of Manchester',
    inNav: false,
    navLabel: 'Granite Subaru',
  },
  {
    path: '/dealerships/granite-pre-owned',
    heading: 'Granite Pre-Owned Center of Merrimack',
    inNav: false,
    navLabel: 'Granite Pre-Owned',
  },
  {
    path: '/dashboard',
    heading: 'How the group is performing, and which store needs attention',
    inNav: true,
    navLabel: 'Dashboard',
  },
  {
    path: '/inventory',
    heading: 'Every listing the three stores carried',
    inNav: true,
    navLabel: 'Inventory',
  },
  {
    path: '/architecture',
    heading: 'A layered batch pipeline',
    inNav: true,
    navLabel: 'Architecture',
  },
  {
    path: '/data-model',
    heading: 'Every fact declares one grain',
    inNav: true,
    navLabel: 'Data Model',
  },
  { path: '/kpis', heading: 'A ratio without both sides', inNav: true, navLabel: 'KPIs' },
  {
    path: '/inventory-operations',
    heading: 'Ingesting something the project did not write',
    inNav: true,
    navLabel: 'Inventory Operations',
  },
  {
    path: '/governance',
    heading: 'The constraints are the design',
    inNav: true,
    navLabel: 'Governance',
  },
  {
    path: '/status',
    heading: 'What is finished, what is not',
    inNav: true,
    navLabel: 'Status',
  },
  {
    path: '/about',
    heading: 'Dealership intelligence built by someone who has run the dealership',
    inNav: true,
    navLabel: 'About',
  },
  { path: '/case-study', heading: 'Case study in progress', inNav: false },
]

/**
 * The HEADER navigation, which is a different list from the routes above.
 *
 * Seven items for fourteen routes, at the declared cap. One of them is a destination GROUP: "Platform"
 * points at `/architecture` and is current on `/data-model`,
 * `/inventory-operations` and `/governance` too, and those four carry a
 * sub-navigation on the page itself.
 *
 * There is no "Dealerships" item. The group overview IS the home page now, so a
 * Dealerships entry would be a second header link to the same document as
 * Overview. The three store pages are reached from the home page's store cards,
 * from `<GroupNav>`, and from the mobile drawer's expanded group.
 *
 * `tests/unit/site.test.ts` asserts this list agrees with `PRIMARY_NAV`, so the
 * two cannot drift.
 *
 * The case study is deliberately not here. It was a bordered control in the
 * header and is now in the footer, on the status page and in the home page's
 * closing section.
 */
export interface HeaderNavItem {
  readonly label: string
  readonly path: string
  /** Pathnames on which this item must carry `aria-current="page"`. */
  readonly currentOn: readonly string[]
}

export const HEADER_NAV: readonly HeaderNavItem[] = [
  { label: 'Overview', path: '/', currentOn: ['/'] },
  { label: 'Dashboard', path: '/dashboard', currentOn: ['/dashboard'] },
  { label: 'Inventory', path: '/inventory', currentOn: ['/inventory'] },
  {
    label: 'Platform',
    path: '/architecture',
    currentOn: ['/architecture', '/data-model', '/inventory-operations', '/governance'],
  },
  { label: 'KPIs', path: '/kpis', currentOn: ['/kpis'] },
  { label: 'Status', path: '/status', currentOn: ['/status'] },
  { label: 'About', path: '/about', currentOn: ['/about'] },
]

/**
 * The console's own internal navigation.
 *
 * Four destinations. `INFORMATION_ARCHITECTURE.md` §1 lists ten console routes; `DASH.2`
 * built the first, `DASH.3` two more and `DASH.7` the fourth. The remaining six are named
 * on the page as text beside the increment that delivers each, and are deliberately not
 * links. A navigation item that goes nowhere is worse than a navigation bar with one item
 * in it.
 */
export const DASHBOARD_NAV_ROUTES: readonly { label: string; path: string }[] = [
  { label: 'Command center', path: '/dashboard' },
  { label: 'Sales and gross', path: '/dashboard/sales-gross' },
  { label: 'Deal Explorer', path: '/dashboard/deals' },
  { label: 'F&I', path: '/dashboard/fi' },
  { label: 'Inventory', path: '/dashboard/inventory' },
  { label: 'Leads and marketing', path: '/dashboard/leads-marketing' },
  { label: 'Employees', path: '/dashboard/employees' },
  { label: 'Accounting', path: '/dashboard/accounting' },
]

/**
 * One Deal Jacket, named once, so every suite drills into the same transaction.
 *
 * `SLE-00000646` is a retail deal with a trade, a linked lead that reached test drive
 * and write-up, and a positive front gross — the shape that exercises the most of the
 * page. The unit suite covers the other six shapes across the whole population; a
 * browser only has to prove that one of them renders, navigates and prints.
 */
export const DEAL_JACKET_SALE_ID = 'SLE-00000646'
export const DEAL_JACKET_ROUTE = `/dashboard/deals/${DEAL_JACKET_SALE_ID}`

/**
 * Every route that renders the console sub-navigation.
 *
 * Five, against four navigation items. `/dashboard/deals/[saleId]` — the Deal
 * Jacket — carries the console bar so a reader who arrived by drill-through can get
 * back out, but it is NOT a navigation destination: a manager reaches a jacket by
 * finding a deal, never by picking one of 650 from a menu. It marks DEALS current
 * rather than F&I, even though it now itemizes F&I: a reader who drilled into one
 * transaction is inside Deals.
 */
export const DASHBOARD_ROUTES: readonly string[] = [
  '/dashboard',
  '/dashboard/sales-gross',
  '/dashboard/deals',
  '/dashboard/fi',
  '/dashboard/inventory',
  '/dashboard/leads-marketing',
  '/dashboard/employees',
  '/dashboard/accounting',
  DEAL_JACKET_ROUTE,
]

/**
 * The console sections that must NOT be reachable, because they do not exist.
 *
 * Asserted as a negative in `dashboard.spec.ts`: no anchor on any dashboard route
 * points at one of these, and each 404s if fetched directly.
 */
export const UNBUILT_DASHBOARD_ROUTES: readonly string[] = [
  /*
   * `/dashboard/deals/[saleId]` was on this list through `DASH.3`, which rendered each
   * deal id as TEXT because an anchor would have pointed at a 404. `DASH.4` delivers
   * the route, so it moves to `DASHBOARD_ROUTES` in the same diff that makes the
   * destination real; `DASH.7` does the same for `/dashboard/fi`, `DASH.9` for
   * `/dashboard/inventory` and `/dashboard/accounting`, `DASH.10` for
   * `/dashboard/leads-marketing` and `DASH.11` for `/dashboard/employees`. What remains
   * here is the ONE section that genuinely does not exist, and
   * `dashboard-deal-jacket.spec.ts` covers the negative that replaced the first one: a deal
   * id that names no transaction still 404s.
   */
  '/dashboard/actions',
]

/**
 * The widths the console's responsive assertions run at.
 *
 * The shared `VIEWPORTS` list is the site-wide matrix and `DASH.13-01` owns adding
 * 390 to it. The console needs it now — 390 is the modern iPhone width and the
 * scoreboard's card presentation is decided between 375 and 430 — so the dashboard
 * suites carry their own list rather than changing the runtime of every existing
 * responsive test ahead of the increment that owns that change.
 */
export const DASHBOARD_VIEWPORTS = [
  { name: '320', width: 320, height: 800 },
  { name: '375', width: 375, height: 812 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 800 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
] as const

/** The four routes that render the platform sub-navigation. */
export const PLATFORM_ROUTES: readonly { label: string; path: string }[] = [
  { label: 'Architecture', path: '/architecture' },
  { label: 'Data model', path: '/data-model' },
  { label: 'Inventory operations', path: '/inventory-operations' },
  { label: 'Governance', path: '/governance' },
]

/**
 * The five ITEMS the Granite Auto Group sub-navigation carries.
 *
 * "The group" points at `/` because the home page is the group overview. The old
 * `/dealerships` path is a permanent redirect to it and is asserted as one in
 * `navigation.spec.ts` rather than swept as a route.
 */
export const GROUP_ROUTES: readonly { label: string; path: string }[] = [
  { label: 'The group', path: '/' },
  { label: 'Granite Chevrolet', path: '/dealerships/granite-chevrolet' },
  { label: 'Granite Subaru', path: '/dealerships/granite-subaru' },
  { label: 'Granite Pre-Owned', path: '/dealerships/granite-pre-owned' },
  { label: 'Inventory explorer', path: '/inventory' },
]

/** Every route the accessibility sweep covers, including the internal lab. */
export const ALL_TESTED_ROUTES: readonly string[] = [
  ...PRIMARY_ROUTES.map((route) => route.path),
  // The console's own sections. They are real routes with real content and are in
  // `ROUTES`, but they are NOT primary navigation destinations: the header carries
  // `Dashboard`, and the console's own bar carries its sections.
  //
  // Membership of THIS list rather than of `PRIMARY_ROUTES` is what exempts them from
  // the public-copy rules in `content-integrity.spec.ts` — no currency figure, no
  // percentage result, no em dash — which were written for the documentation routes and
  // which the console legitimately breaks: it renders governed KPI values from a
  // versioned export, under the fifteen conditions ADR-0013 states. `/dashboard/fi` was
  // briefly in `PRIMARY_ROUTES` during `DASH.7` and failed four of those rules on its
  // first browser run, which is the mechanism working: a console route added to the wrong
  // list is caught rather than quietly exempted.
  '/dashboard/sales-gross',
  '/dashboard/deals',
  '/dashboard/fi',
  '/dashboard/inventory',
  '/dashboard/leads-marketing',
  '/dashboard/employees',
  '/dashboard/accounting',
  '/ui-lab',
]

/**
 * Routes the accessibility sweep covers that are NOT in the site's route map.
 *
 * `ALL_TESTED_ROUTES` is asserted equal to the route map by `tests/unit/site.test.ts`,
 * which is what makes this file a second opinion rather than a copy. A drill-through
 * is deliberately absent from that map — there are 650 Deal Jackets, the sitemap lists
 * the index only, and each jacket asks not to be indexed — so it cannot go on that
 * list without breaking a real invariant.
 *
 * It still needs scanning: the Deal Jacket is the densest page in the console, with
 * four calculation blocks, a timeline, a checklist and a disclosure. So it gets its
 * own list, and the sweep runs over both.
 */
export const DRILL_THROUGH_ROUTES: readonly string[] = [DEAL_JACKET_ROUTE]

/**
 * The routes that RENDER that sub-navigation.
 *
 * Four, not five: the home page is itself the group overview, so a sub-navigation
 * bar on it would be a rail whose first item points at the document the reader is
 * already on. The home page reaches every store through its store-cards section
 * instead, which `inventory.spec.ts` asserts.
 */
export const GROUP_NAV_ROUTES: readonly { label: string; path: string }[] =
  GROUP_ROUTES.filter((route) => route.path !== '/')

/**
 * Paths that must answer with a permanent redirect rather than a page.
 *
 * `/dealerships` was the group overview until the home page became it. It stays
 * resolvable because it is bookmarked, linked from documentation and already in
 * a fetched sitemap - and it must NOT take the store routes beneath it with it,
 * which is why the redirect is declared on the exact path.
 */
export const PERMANENT_REDIRECTS: readonly { from: string; to: string }[] = [
  { from: '/dealerships', to: '/' },
]

/** The viewport matrix the responsive assertions run at. */
export const VIEWPORTS = [
  { name: '320', width: 320, height: 800 },
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 800 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
] as const
