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
    heading: 'One governed view of dealership performance',
    inNav: true,
    navLabel: 'Overview',
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
    heading: 'Twenty-five years in dealerships',
    inNav: true,
    navLabel: 'About',
  },
  { path: '/case-study', heading: 'Case study in progress', inNav: false },
]

/** Every route the accessibility sweep covers, including the internal lab. */
export const ALL_TESTED_ROUTES: readonly string[] = [
  ...PRIMARY_ROUTES.map((route) => route.path),
  '/ui-lab',
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
