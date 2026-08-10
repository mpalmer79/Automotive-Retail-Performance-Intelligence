/**
 * Links BETWEEN operating routes, carrying the analytical context that survives
 * the journey and dropping the context that does not.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Before `UX.1` every console route rendered its own filter form and every link
 * between two routes was a bare pathname. A general manager who had selected
 * December and the Manchester store on the Executive surface, drilled into Sales
 * and Gross, and then moved on to Inventory had rebuilt the same two selections
 * three times. The URL grammar was already the shareable source of analytical
 * state; what was missing was anything that carried it across a navigation.
 *
 * THE RULE, AND WHY IT IS NOT "CARRY EVERYTHING"
 * ---------------------------------------------
 * Each route already declares, in `filters.ts`, what it can honestly do with each
 * parameter: `applied`, `partial` or `not-applicable`. That declaration is the
 * whole basis of this module.
 *
 *   applied / partial   the destination acts on it, so it travels
 *   not-applicable      the destination's data carries no such attribute, so it
 *                       is DROPPED rather than carried into a page that would
 *                       display it as an active filter doing nothing
 *
 * Carrying everything would be worse than carrying nothing. `?source=LDS-007`
 * arriving on `/dashboard/accounting` renders a chip saying a lead source is
 * selected on a page whose every figure ignores it, and a reader who believes a
 * filter is working is in a worse position than one who can see it was dropped.
 *
 * WHAT THIS MODULE MAY NOT DO
 * ---------------------------
 * It selects nothing and computes nothing. It maps a filter context onto a URL,
 * and the destination re-parses that URL through `parseFilters` exactly as though
 * a reader had typed it. There is no second source of analytical state, no
 * client-held selection and no transfer that bypasses the grammar — which is what
 * keeps "the link reproduces the view" true after a navigation as well as after a
 * copy and paste.
 *
 * Pure: no React, no `window`, no data import.
 */
import {
  ACCOUNTING_SUPPORT,
  DEAL_EXPLORER_SUPPORT,
  EMPLOYEES_SUPPORT,
  EXECUTIVE_OVERVIEW_SUPPORT,
  FI_SUPPORT,
  FILTER_KEYS,
  INVENTORY_SUPPORT,
  LEADS_MARKETING_SUPPORT,
  SALES_GROSS_SUPPORT,
  DEFAULT_FILTERS,
  filterValue,
  type DashboardFilters,
  type FilterKey,
  type RouteFilterSupport,
} from './filters'

/**
 * Every operating route and the support matrix it publishes.
 *
 * Keyed by pathname because that is what a link has and what `usePathname`
 * returns. The Deal Jacket is deliberately absent as a KEY — nothing links INTO a
 * specific deal from the rail — but is resolved by prefix below, because a reader
 * standing on one still has a filter context that should follow them back out.
 */
const ROUTE_SUPPORT: Readonly<Record<string, RouteFilterSupport>> = {
  '/': EXECUTIVE_OVERVIEW_SUPPORT,
  '/dashboard/sales-gross': SALES_GROSS_SUPPORT,
  '/dashboard/deals': DEAL_EXPLORER_SUPPORT,
  '/dashboard/inventory': INVENTORY_SUPPORT,
  '/dashboard/fi': FI_SUPPORT,
  '/dashboard/leads-marketing': LEADS_MARKETING_SUPPORT,
  '/dashboard/employees': EMPLOYEES_SUPPORT,
  '/dashboard/accounting': ACCOUNTING_SUPPORT,
}

/**
 * The support matrix for a pathname, or `undefined` outside the application.
 *
 * A Deal Jacket resolves to the Deal Explorer's matrix. It is a drill-through into
 * one row of that index and it filters nothing of its own: a jacket shows one deal
 * whatever the period says. Treating it as the index for the purpose of carrying
 * context is what lets the rail links work while a reader is inside one.
 */
export function routeFilterSupport(pathname: string): RouteFilterSupport | undefined {
  const exact = ROUTE_SUPPORT[pathname]
  if (exact !== undefined) return exact
  if (pathname.startsWith('/dashboard/deals/')) return DEAL_EXPLORER_SUPPORT
  return undefined
}

/**
 * The parameters a destination will act on, in canonical order.
 *
 * `partial` counts as applicable. A partial parameter changes SOME of what the
 * destination shows and the destination says which — that is a filter doing
 * something, and dropping it would lose a selection the reader can see working.
 */
export function applicableFilterKeys(pathname: string): readonly FilterKey[] {
  const support = routeFilterSupport(pathname)
  if (support === undefined) return []
  return FILTER_KEYS.filter((key) => support[key].support !== 'not-applicable')
}

/** Which of the currently-set parameters a destination would drop. */
export function droppedFilterKeys(
  filters: DashboardFilters,
  pathname: string
): readonly FilterKey[] {
  const applicable = new Set(applicableFilterKeys(pathname))
  return FILTER_KEYS.filter(
    (key) => filterValue(filters, key) !== null && !applicable.has(key)
  )
}

/**
 * A copy of the filter context reduced to what the destination can act on.
 *
 * Every dropped parameter is returned to its DEFAULT rather than removed from the
 * object, so the result is a complete, valid `DashboardFilters` that serializes
 * through the ordinary path. There is no partially-populated intermediate state
 * and no second serializer.
 */
export function filtersForRoute(
  filters: DashboardFilters,
  pathname: string
): DashboardFilters {
  const applicable = new Set(applicableFilterKeys(pathname))
  const next: DashboardFilters = {
    period: applicable.has('period') ? filters.period : DEFAULT_FILTERS.period,
    compare: applicable.has('compare') ? filters.compare : DEFAULT_FILTERS.compare,
    store: applicable.has('store') ? filters.store : DEFAULT_FILTERS.store,
    scope: applicable.has('scope') ? filters.scope : DEFAULT_FILTERS.scope,
    dept: applicable.has('dept') ? filters.dept : null,
    employee: applicable.has('employee') ? filters.employee : null,
    source: applicable.has('source') ? filters.source : null,
    campaign: applicable.has('campaign') ? filters.campaign : null,
    make: applicable.has('make') ? filters.make : null,
    model: applicable.has('model') ? filters.model : null,
    condition: applicable.has('condition') ? filters.condition : null,
    structure: applicable.has('structure') ? filters.structure : null,
    product: applicable.has('product') ? filters.product : null,
  }
  return next
}

/**
 * The href for an operating destination, carrying the compatible context.
 *
 * Deterministic: the query string is produced by `serializeFilters`, which emits
 * `FILTER_KEYS` order, omits defaults and sorts a store list, so two equivalent
 * states produce byte-identical URLs and a parameter can never appear twice. A
 * destination at its default state is the bare pathname, which is what makes the
 * rail's own links clean when nothing is selected.
 *
 * A pathname outside the application — `/technical`, `/about` — carries NO filter
 * state at all. Those pages have no analytical context to reproduce, and a
 * `?period=2025-12` on the governance page is noise in a shared link.
 */
export function operatingHref(pathname: string, filters: DashboardFilters): string {
  const support = routeFilterSupport(pathname)
  if (support === undefined) return pathname
  const reduced = filtersForRoute(filters, pathname)
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = filterValue(reduced, key)
    if (value !== null) params.set(key, value)
  }
  const query = params.toString()
  return query === '' ? pathname : `${pathname}?${query}`
}
