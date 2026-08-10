/**
 * What a management action is allowed to be, checked in the language that owns the routes.
 *
 * WHY THE ROUTE CHECK LIVES HERE AND NOT IN PYTHON
 * -----------------------------------------------
 * The exporter builds each drill-through from a route and a parameter map declared in
 * `config/dashboard/action_rules.yaml`, and it validates what it can: that the path is
 * absolute, that every `{slot}` names an exported column, that a null value drops its
 * parameter rather than emitting an empty one. What it cannot validate is whether
 * `/dashboard/inventory` still exists, or whether `?unit=` still means anything there —
 * those facts live in `site.ts` and `filters.ts`, and copying the whole route registry into
 * Python to answer them would create exactly the second source of truth this project spends
 * its time refusing.
 *
 * So the check is split at the language boundary. Python guarantees the URL is well formed
 * and deterministic; this module guarantees it resolves to a route the console actually
 * serves, carrying only parameters that route actually reads. The generator runs it over
 * every action before writing anything, so a retired route or a renamed parameter fails the
 * build rather than shipping a link that quietly lands on an unfiltered page.
 *
 * TWO KINDS OF PARAMETER
 * ----------------------
 * A GLOBAL parameter is one of the thirteen `FILTER_KEYS`, and it is valid at a destination
 * exactly when that destination's support matrix does not mark it `not-applicable` — the
 * same rule `operatingHref` follows when it decides what survives a navigation. A LOCAL
 * parameter belongs to one route and means nothing anywhere else: `unit` selects a vehicle
 * on the inventory surface and is meaningless on the accounting one. Both are declared;
 * neither is inferred.
 *
 * Pure: no React, no `window`, no data import.
 */
import {
  ACTION_DOMAINS,
  ACTION_OWNER_ROLES,
  ACTION_SEVERITIES,
  type ActionDomain,
  type ActionOwnerRole,
  type ActionSeverity,
} from '@/types/dashboard'

import { applicableFilterKeys } from './navigation'

/**
 * Parameters a route reads that are NOT part of the global filter grammar.
 *
 * Each is a real parameter of the page named, verified against the page that parses it. A
 * route absent from this map accepts no local parameter at all.
 */
const LOCAL_ROUTE_PARAMS: Readonly<Record<string, readonly string[]>> = {
  '/dashboard/inventory': ['unit', 'q', 'sort'],
  '/dashboard/deals': ['deal', 'q', 'sort'],
  '/dashboard/actions': ['severity', 'domain', 'owner'],
}

/** Routes an action may send a reader to. Every one is a current operating surface. */
const DRILL_THROUGH_ROUTES: readonly string[] = [
  '/',
  '/dashboard/sales-gross',
  '/dashboard/deals',
  '/dashboard/inventory',
  '/dashboard/fi',
  '/dashboard/leads-marketing',
  '/dashboard/employees',
  '/dashboard/accounting',
  '/dashboard/actions',
]

/** A Deal Jacket path, `/dashboard/deals/SLE-00000001`. */
const DEAL_JACKET = /^\/dashboard\/deals\/[A-Z]{3}-\d{8}$/

/** How each domain is labelled. */
export const DOMAIN_LABELS: Readonly<Record<ActionDomain, string>> = {
  inventory: 'Inventory',
  'sales-gross': 'Sales & Gross',
  fi: 'F&I',
  leads: 'Leads',
  accounting: 'Accounting',
}

/** How each severity is labelled. Always rendered as TEXT beside any colour. */
export const SEVERITY_LABELS: Readonly<Record<ActionSeverity, string>> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

/** Whether a value is one of the governed severities. */
export function isActionSeverity(value: string): value is ActionSeverity {
  return (ACTION_SEVERITIES as readonly string[]).includes(value)
}

/** Whether a value is one of the governed domains. */
export function isActionDomain(value: string): value is ActionDomain {
  return (ACTION_DOMAINS as readonly string[]).includes(value)
}

/** Whether a value is one of the governed review roles. */
export function isActionOwnerRole(value: string): value is ActionOwnerRole {
  return (ACTION_OWNER_ROLES as readonly string[]).includes(value)
}

/** The reason a drill-through was refused, or `null` when it resolves. */
export function drillThroughProblem(href: string): string | null {
  if (!href.startsWith('/')) return `${href} is not an absolute path`
  const [path, query = ''] = href.split('?')
  if (path === undefined) return `${href} has no path`
  const known = DRILL_THROUGH_ROUTES.includes(path) || DEAL_JACKET.test(path)
  if (!known) {
    return `${path} is not a current operating route; the UX.1 route map is authoritative`
  }
  if (query === '') return null

  // A Deal Jacket shows one deal whatever any filter says, so a parameter on one is a
  // reader being told a selection is doing something it is not.
  if (DEAL_JACKET.test(path)) {
    return `${href} carries query parameters, but a Deal Jacket filters nothing`
  }
  const allowed = new Set<string>([
    ...applicableFilterKeys(path),
    ...(LOCAL_ROUTE_PARAMS[path] ?? []),
  ])
  const seen = new Set<string>()
  for (const pair of query.split('&')) {
    const [key = '', value = ''] = pair.split('=')
    if (key === '') return `${href} carries an empty parameter name`
    if (value === '') return `${href} carries ${key} with no value`
    if (seen.has(key)) return `${href} repeats the parameter ${key}`
    seen.add(key)
    if (!allowed.has(key)) {
      return `${path} does not read ${key}; a link that filters on nothing is worse than one that does not filter`
    }
  }
  return null
}
