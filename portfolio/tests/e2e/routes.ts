/**
 * The route list the end-to-end suites sweep.
 *
 * Duplicated from `src/lib/site.ts` deliberately: importing the app's own route
 * map would mean a route deleted from the map silently disappears from the test
 * sweep as well, and the suite would go green while covering less. An
 * independent list is a second opinion, and `tests/unit/site.test.ts` asserts
 * the two agree.
 *
 * `UX.1` RESHAPED THIS FILE, AND THE RESHAPING IS THE POINT
 * --------------------------------------------------------
 * There are two information domains now — an operating application and a
 * reference destination — and the constants below name them separately, because a
 * sweep that treats `/dashboard/fi` and `/governance` as the same kind of page
 * cannot check what is true of each. Nothing was deleted from the sweep: the six
 * retired documentation routes are asserted as REDIRECTS, and the content they
 * carried is swept as the technical destination's eight views.
 */
export interface RouteUnderTest {
  readonly path: string
  /** The expected h1, as a substring. */
  readonly heading: string
  /** Whether the route appears in the reference domain's header navigation. */
  readonly inNav: boolean
  /** The header navigation label, where it has one. */
  readonly navLabel?: string
}

/**
 * The reference domain: what a reader reaches deliberately.
 *
 * These wear the site header and footer and are held to the public-copy rules in
 * `content-integrity.spec.ts`. The operating routes are held to different rules
 * and are listed separately below.
 */
export const PRIMARY_ROUTES: readonly RouteUnderTest[] = [
  {
    path: '/technical',
    heading: 'How ARPI works',
    inNav: true,
    navLabel: 'Technical',
  },
  {
    path: '/about',
    heading: 'Dealership intelligence built by someone who has run the dealership',
    inNav: true,
    navLabel: 'About',
  },
  {
    path: '/inventory',
    heading: 'Every listing the three stores carried',
    // Reachable from the group sub-navigation and from the footer index, and
    // deliberately NOT from the operating rail: see the route comment in
    // `lib/site.ts` on the two surfaces that were both called Inventory.
    inNav: true,
    navLabel: 'Reference listings',
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
  { path: '/case-study', heading: 'Case study in progress', inNav: false },
]

/**
 * The reference domain's HEADER navigation.
 *
 * Three items, down from seven. The first returns to the operating application,
 * because every route this header serves is one a reader arrived at FROM there.
 * The operating application's own eight destinations are in the rail, which is a
 * different component on a different set of routes; `OPERATING_NAV_ROUTES` below
 * is the second opinion on that one.
 *
 * `tests/unit/site.test.ts` asserts this list agrees with `PRIMARY_NAV`.
 */
export interface HeaderNavItem {
  readonly label: string
  readonly path: string
  /** Pathnames on which this item must carry `aria-current="page"`. */
  readonly currentOn: readonly string[]
}

export const HEADER_NAV: readonly HeaderNavItem[] = [
  { label: 'Executive', path: '/', currentOn: ['/'] },
  { label: 'Technical', path: '/technical', currentOn: ['/technical'] },
  { label: 'About', path: '/about', currentOn: ['/about'] },
]

/**
 * The operating application's rail.
 *
 * Eight destinations, in the order a manager works. `Actions` is deliberately
 * absent: `DASH.12` has not been built, and `dashboard.spec.ts` asserts no anchor
 * anywhere points at `/dashboard/actions`.
 */
export const OPERATING_NAV_ROUTES: readonly { label: string; path: string }[] = [
  { label: 'Executive', path: '/' },
  { label: 'Sales & Gross', path: '/dashboard/sales-gross' },
  { label: 'Deals', path: '/dashboard/deals' },
  { label: 'Inventory', path: '/dashboard/inventory' },
  { label: 'F&I', path: '/dashboard/fi' },
  { label: 'Leads & Marketing', path: '/dashboard/leads-marketing' },
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
 * Every route that wears the operating shell.
 *
 * Nine, against eight rail destinations. The Deal Jacket wears the shell so a
 * reader who arrived by drill-through can get back out, but it is NOT a rail
 * destination: a manager reaches a jacket by finding a deal, never by picking one
 * of 650 from a menu. It marks DEALS current rather than F&I, even though it
 * itemizes F&I: a reader who drilled into one transaction is inside Deals.
 */
export const DASHBOARD_ROUTES: readonly string[] = [
  '/',
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
 * Asserted as a negative in `dashboard.spec.ts`: no anchor on any operating route
 * points at one of these, and each 404s if fetched directly.
 *
 * EMPTY SINCE `DASH.12`. It held `/dashboard/actions` from the increment that named
 * the section until the increment that built it, and the negative assertion is what
 * stopped a navigation item arriving first. The export stays so the next planned
 * section has a guard waiting for it.
 */
export const UNBUILT_DASHBOARD_ROUTES: readonly string[] = []

/**
 * The widths the console's responsive assertions run at.
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

/**
 * The technical destination's eight view states.
 *
 * One route, eight server-addressable states, each with its own canonical link.
 * The sweep visits all eight because six of them carry content that used to be a
 * route of its own and the other two are new: a consolidation that quietly stopped
 * rendering one of the six would otherwise go unnoticed.
 */
export const TECHNICAL_VIEW_ROUTES: readonly { label: string; path: string }[] = [
  { label: 'Overview', path: '/technical' },
  { label: 'Architecture', path: '/technical?view=architecture' },
  { label: 'Data model', path: '/technical?view=data-model' },
  { label: 'KPI catalogue', path: '/technical?view=kpis' },
  { label: 'Governance', path: '/technical?view=governance' },
  { label: 'Data sources', path: '/technical?view=data-sources' },
  { label: 'Status', path: '/technical?view=status' },
  { label: 'Product vision', path: '/technical?view=product-vision' },
]

/**
 * The five ITEMS the Granite Auto Group sub-navigation carries.
 *
 * "The group" points at the technical overview, which is where the store story
 * went when the home page became the operating console.
 */
export const GROUP_ROUTES: readonly { label: string; path: string }[] = [
  { label: 'The group', path: '/technical?view=overview' },
  { label: 'Granite Chevrolet', path: '/dealerships/granite-chevrolet' },
  { label: 'Granite Subaru', path: '/dealerships/granite-subaru' },
  { label: 'Granite Pre-Owned', path: '/dealerships/granite-pre-owned' },
  { label: 'Reference listings', path: '/inventory' },
]

/** Every route the accessibility sweep covers, including the internal lab. */
export const ALL_TESTED_ROUTES: readonly string[] = [
  ...PRIMARY_ROUTES.map((route) => route.path),
  // The operating application. Real routes with real content, in `ROUTES`, and
  // NOT reference destinations.
  //
  // Membership of THIS list rather than of `PRIMARY_ROUTES` is what exempts them
  // from the public-copy rules in `content-integrity.spec.ts` — no currency
  // figure, no percentage result, no em dash — which were written for the
  // documentation routes and which the console legitimately breaks: it renders
  // governed KPI values from a versioned export, under the fifteen conditions
  // ADR-0013 states.
  '/',
  '/dashboard/sales-gross',
  '/dashboard/deals',
  '/dashboard/fi',
  '/dashboard/inventory',
  '/dashboard/leads-marketing',
  '/dashboard/employees',
  '/dashboard/accounting',
  '/dashboard/actions',
  '/ui-lab',
]

/**
 * Routes the accessibility sweep covers that are NOT in the site's route map.
 *
 * `ALL_TESTED_ROUTES` is asserted equal to the route map by
 * `tests/unit/site.test.ts`, which is what makes this file a second opinion rather
 * than a copy. A drill-through is deliberately absent from that map — there are
 * 650 Deal Jackets and the sitemap lists the index only — so it cannot go on that
 * list without breaking a real invariant. The seven non-default technical views
 * are absent for a different reason: they are states of one route, not routes.
 *
 * Both still need scanning, so they get their own list and the sweep runs over it.
 */
export const DRILL_THROUGH_ROUTES: readonly string[] = [
  DEAL_JACKET_ROUTE,
  ...TECHNICAL_VIEW_ROUTES.filter((view) => view.path !== '/technical').map(
    (view) => view.path
  ),
]

/**
 * The routes that RENDER the group sub-navigation.
 *
 * Four, not five: the technical overview carries the store story in its own body,
 * so a sub-navigation bar whose first item points at the document the reader is
 * already on would be a rail to nowhere.
 */
export const GROUP_NAV_ROUTES: readonly { label: string; path: string }[] =
  GROUP_ROUTES.filter((route) => route.path !== '/technical?view=overview')

/**
 * Paths that must answer with a permanent redirect rather than a page.
 *
 * Eight, and every one of them was a real destination that a reader may have
 * bookmarked, a document may link to, and a search engine has already fetched.
 *
 *   `/dashboard`   the operating console's old URL. `UX.1` made `/` the canonical
 *                  entry experience, so this is the redirect that matters most:
 *                  `navigation.spec.ts` asserts the QUERY STRING survives it, or
 *                  every shared console link silently loses its filters.
 *   `/dealerships` the group overview, before the home page became it.
 *   six documentation routes
 *                  consolidated into `/technical?view=...`.
 *
 * None of these may take a path beneath it: `/dashboard/sales-gross` and the three
 * store pages stay exactly where they are, which is asserted alongside.
 */
export const PERMANENT_REDIRECTS: readonly { from: string; to: string }[] = [
  { from: '/dashboard', to: '/' },
  { from: '/dealerships', to: '/' },
  { from: '/architecture', to: '/technical?view=architecture' },
  { from: '/data-model', to: '/technical?view=data-model' },
  { from: '/kpis', to: '/technical?view=kpis' },
  { from: '/governance', to: '/technical?view=governance' },
  { from: '/status', to: '/technical?view=status' },
  { from: '/inventory-operations', to: '/technical?view=data-sources' },
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
