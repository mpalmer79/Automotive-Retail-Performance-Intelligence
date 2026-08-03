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
 * Six items for thirteen routes. One of them is a destination GROUP: "Platform"
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
  '/ui-lab',
]

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
