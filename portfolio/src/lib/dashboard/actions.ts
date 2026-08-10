/**
 * The Action Center's view model: SELECTION over a queue that is already decided.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It does not evaluate a rule, decide a severity, read a threshold, build a drill-through
 * or recompute a business figure. Every one of those happened at export time, in Python,
 * against `config/dashboard/action_rules.yaml`, and the generator has already refused
 * anything it could not verify. What is left for the console is choosing which of the
 * decided rows to show and arranging them legibly.
 *
 * That division is what makes the queue reproducible. Two readers with the same URL and the
 * same dataset version see the same actions in the same order, because the order is a
 * property of the data rather than of the session.
 *
 * ORDERING
 * --------
 * Severity first, then domain, then store, then rule, then entity — a total order over
 * values every action carries. There is no composite score, no recency weighting and no
 * personalisation. A reader who wants to know why one action sits above another can read
 * the answer off the two rows.
 *
 * FACETS
 * ------
 * Four, all in the URL: domain, severity, store and review role. They narrow a set; they
 * never re-run anything. Counts are recomputed from the queue rather than read from the
 * manifest, so a filtered view's counts are the counts of what is on screen — and a test
 * asserts the unfiltered ones equal the manifest's.
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
  type ManagementAction,
} from '@/types/dashboard'

import { isActionDomain, isActionOwnerRole, isActionSeverity } from './action-contract'

/** The route's own parameters, outside the global filter grammar. */
export interface ActionFacets {
  readonly severity: ActionSeverity | null
  readonly domain: ActionDomain | null
  readonly owner: ActionOwnerRole | null
  readonly store: readonly string[]
}

/** No facet selected. */
export const NO_FACETS: ActionFacets = {
  severity: null,
  domain: null,
  owner: null,
  store: [],
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/**
 * Parse the facet parameters from a query.
 *
 * An unrecognised value is DROPPED rather than rejected: a stale link with
 * `?severity=urgent` should show the whole queue, which is honest, instead of an error page
 * or — much worse — an empty one that reads as "no conditions found".
 */
export function parseActionFacets(
  query: Record<string, string | string[] | undefined>,
  knownStores: readonly string[]
): ActionFacets {
  const severity = firstValue(query['severity'])
  const domain = firstValue(query['domain'])
  const owner = firstValue(query['owner'])
  const store = firstValue(query['store'])
  const stores =
    store === null
      ? []
      : store
          .split(',')
          .map((code) => code.trim())
          .filter((code) => knownStores.includes(code))
  return {
    severity: severity !== null && isActionSeverity(severity) ? severity : null,
    domain: domain !== null && isActionDomain(domain) ? domain : null,
    owner: owner !== null && isActionOwnerRole(owner) ? owner : null,
    store: [...new Set(stores)].sort(),
  }
}

/**
 * Serialise facets back to a query string.
 *
 * Canonical: keys in a fixed order, stores sorted and deduplicated, defaults omitted. Two
 * equivalent selections therefore produce byte-identical URLs, which is what makes a shared
 * link reproduce a view rather than approximate one.
 */
export function serializeActionFacets(facets: ActionFacets): string {
  const params = new URLSearchParams()
  if (facets.severity !== null) params.set('severity', facets.severity)
  if (facets.domain !== null) params.set('domain', facets.domain)
  if (facets.owner !== null) params.set('owner', facets.owner)
  if (facets.store.length > 0) params.set('store', [...facets.store].sort().join(','))
  return params.toString()
}

/** The Action Center href for a facet selection. */
export function actionsHref(facets: ActionFacets): string {
  const query = serializeActionFacets(facets)
  return query === '' ? '/dashboard/actions' : `/dashboard/actions?${query}`
}

/** The href that results from toggling one facet, so every control is a plain link. */
export function toggleFacetHref<K extends 'severity' | 'domain' | 'owner'>(
  facets: ActionFacets,
  key: K,
  value: ActionFacets[K]
): string {
  const next: ActionFacets = { ...facets, [key]: facets[key] === value ? null : value }
  return actionsHref(next)
}

/** The href that results from toggling one store. */
export function toggleStoreHref(facets: ActionFacets, store: string): string {
  const selected = facets.store.includes(store)
    ? facets.store.filter((code) => code !== store)
    : [...facets.store, store]
  return actionsHref({ ...facets, store: selected })
}

/** Narrow the queue. Filtering only ever removes rows; it never reorders or recomputes. */
export function selectActions(
  actions: readonly ManagementAction[],
  facets: ActionFacets
): readonly ManagementAction[] {
  return actions.filter((action) => {
    if (facets.severity !== null && action.severity !== facets.severity) return false
    if (facets.domain !== null && action.domain !== facets.domain) return false
    if (facets.owner !== null && action.ownerRole !== facets.owner) return false
    if (facets.store.length > 0) {
      if (action.store === null || !facets.store.includes(action.store)) return false
    }
    return true
  })
}

/** One facet option and how many actions carry it. */
export interface FacetOption<T extends string> {
  readonly value: T
  readonly label: string
  readonly count: number
  readonly selected: boolean
}

function tally<T extends string>(
  actions: readonly ManagementAction[],
  pick: (action: ManagementAction) => T | null,
  order: readonly T[],
  label: (value: T) => string,
  selected: T | null
): readonly FacetOption<T>[] {
  const counts = new Map<T, number>()
  for (const action of actions) {
    const key = pick(action)
    if (key === null) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return order
    .filter((value) => counts.has(value) || value === selected)
    .map((value) => ({
      value,
      label: label(value),
      count: counts.get(value) ?? 0,
      selected: value === selected,
    }))
}

/** The queue summary and the four facet controls. */
export interface ActionQueueView {
  readonly total: number
  readonly shown: number
  readonly severities: readonly FacetOption<ActionSeverity>[]
  readonly domains: readonly FacetOption<ActionDomain>[]
  readonly owners: readonly FacetOption<ActionOwnerRole>[]
  readonly stores: readonly FacetOption<string>[]
  readonly actions: readonly ManagementAction[]
}

/**
 * Build the whole view for one facet selection.
 *
 * Facet counts are computed over the WHOLE queue, not the filtered one. A count that fell
 * to zero the moment its own facet was selected would tell a reader nothing about what
 * selecting a different value would show them, which is the only question a facet count
 * exists to answer.
 */
export function buildActionQueue(
  actions: readonly ManagementAction[],
  facets: ActionFacets,
  storeLabels: Readonly<Record<string, string>>,
  domainLabels: Readonly<Record<ActionDomain, string>>,
  severityLabels: Readonly<Record<ActionSeverity, string>>
): ActionQueueView {
  const shown = selectActions(actions, facets)
  const storeCodes = [
    ...new Set(actions.map((action) => action.store).filter((code): code is string => code !== null)),
  ].sort()
  return {
    total: actions.length,
    shown: shown.length,
    severities: tally(
      actions,
      (action) => action.severity,
      ACTION_SEVERITIES,
      (value) => severityLabels[value],
      facets.severity
    ),
    domains: tally(
      actions,
      (action) => action.domain,
      ACTION_DOMAINS,
      (value) => domainLabels[value],
      facets.domain
    ),
    owners: tally(
      actions,
      (action) => action.ownerRole,
      ACTION_OWNER_ROLES,
      (value) => value,
      facets.owner
    ),
    stores: tally(
      actions,
      (action) => action.store,
      storeCodes,
      (value) => storeLabels[value] ?? value,
      facets.store.length === 1 ? (facets.store[0] ?? null) : null
    ).map((option) => ({ ...option, selected: facets.store.includes(option.value) })),
    actions: shown,
  }
}

/**
 * The few prompts the Executive Overview shows.
 *
 * The queue's order already runs most severe first, so this is a prefix of it and nothing
 * more. No rotation, no sampling, no personalisation and no second ordering rule: the same
 * dataset version shows the same prompts to everyone, and "view all" leads to the same rows
 * in the same sequence.
 */
export function topActions(
  actions: readonly ManagementAction[],
  limit: number
): readonly ManagementAction[] {
  return actions.slice(0, limit)
}

/**
 * The one evidence value a compact row leads with.
 *
 * The FIRST evidence field the rule declared. Rule authors order evidence deliberately —
 * the days in stock, the gross, the unresponded count — so leading with the first is the
 * rule's own choice rather than a heuristic this module invented.
 */
export function primaryEvidence(action: ManagementAction): ManagementAction['evidence'][number] | null {
  return action.evidence[0] ?? null
}
