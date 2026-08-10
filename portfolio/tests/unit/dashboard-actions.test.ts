/**
 * The Action Center's view model and the change-driver display policy.
 *
 * The console's half of `DASH.12` decides nothing, so these tests are about two things: that
 * selection stays selection, and that the one arithmetic operation the increment adds —
 * grouping immaterial bridge effects into a remainder — reconciles exactly on every shape a
 * bridge can take, including the ones the committed data does not happen to contain.
 */
import { describe, expect, it } from 'vitest'

import { drillThroughProblem } from '@/lib/dashboard/action-contract'
import {
  actionsHref,
  buildActionQueue,
  parseActionFacets,
  primaryEvidence,
  selectActions,
  serializeActionFacets,
  toggleFacetHref,
  toggleStoreHref,
  topActions,
  NO_FACETS,
} from '@/lib/dashboard/actions'
import { managementActions } from '@/lib/dashboard/actions-data'
import { buildBridge, buildChangeDrivers } from '@/lib/dashboard/change-drivers'
import { grossChangeBridgeRows } from '@/lib/dashboard/change-drivers-data'
import { addExact, compareExact, exactToString, sumExact } from '@/lib/dashboard/decimal'
import { dashboardManifest, dashboardStores } from '@/lib/dashboard/data'
import {
  ACTION_DOMAINS,
  ACTION_OWNER_ROLES,
  ACTION_SEVERITIES,
  type ActionDomain,
  type ActionSeverity,
} from '@/types/dashboard'

const ACTIONS = managementActions()
const STORE_IDS = dashboardStores.map((store) => store.id)
const STORE_LABELS = Object.fromEntries(
  dashboardStores.map((store) => [store.id, store.shortName])
)
const DOMAIN_LABELS = Object.fromEntries(
  ACTION_DOMAINS.map((domain) => [domain, domain])
) as Record<ActionDomain, string>
const SEVERITY_LABELS = Object.fromEntries(
  ACTION_SEVERITIES.map((severity) => [severity, severity])
) as Record<ActionSeverity, string>

describe('the committed queue', () => {
  it('agrees with the manifest it was written beside', () => {
    expect(ACTIONS).toHaveLength(dashboardManifest.actions.rowCount)
    expect(dashboardManifest.actions.schema).toBe('arpi.management_actions/1')
  })

  it('carries only governed vocabulary', () => {
    for (const action of ACTIONS) {
      expect(ACTION_SEVERITIES).toContain(action.severity)
      expect(ACTION_DOMAINS).toContain(action.domain)
      expect(ACTION_OWNER_ROLES).toContain(action.ownerRole)
    }
  })

  it('runs most severe first, under a total order', () => {
    const ranks = ACTIONS.map((action) => ACTION_SEVERITIES.indexOf(action.severity))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    const ids = ACTIONS.map((action) => action.actionId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('resolves every drill-through against the console route registry', () => {
    for (const action of ACTIONS) {
      expect(drillThroughProblem(action.drillThrough), action.actionId).toBeNull()
    }
  })

  it('discloses every rule-owned threshold as a project default', () => {
    for (const action of ACTIONS) {
      for (const threshold of action.thresholdsUsed) {
        if (threshold.source === 'project-default-review-threshold') {
          expect(threshold.label.toLowerCase()).toContain('project default')
        }
      }
    }
  })

  it('reaches the console with the governed aged threshold, not a literal', () => {
    /*
     * The number a reader sees comes from the export's own column. If a rule had restated
     * "aged" as the planning document's 90 days, this would show 90 and fail.
     */
    const aged = ACTIONS.filter((action) => action.ruleId === 'ACT-INV-001')
    expect(aged.length).toBeGreaterThan(0)
    for (const action of aged) {
      const disclosed = action.thresholdsUsed.find((t) => t.name === 'aged_threshold_days')
      expect(disclosed?.value).toBe('60')
      expect(disclosed?.source).toBe('governed')
    }
  })

  it('carries no personal data of any kind', () => {
    const text = JSON.stringify(ACTIONS).toLowerCase()
    for (const banned of [
      'customer_name',
      'email',
      'phone',
      'salary',
      'credit_score',
      'employee_name',
    ]) {
      expect(text).not.toContain(banned)
    }
  })

  it('carries no workflow state, because none exists', () => {
    const text = JSON.stringify(ACTIONS).toLowerCase()
    for (const banned of ['assigned', 'acknowledged', 'completed', 'overdue', 'created_at']) {
      expect(text).not.toContain(banned)
    }
  })
})

describe('facets narrow the queue and never re-run it', () => {
  it('parses the four route parameters', () => {
    const facets = parseActionFacets(
      { severity: 'high', domain: 'inventory', owner: 'Used-car manager', store: 'GSA-001' },
      STORE_IDS
    )
    expect(facets).toEqual({
      severity: 'high',
      domain: 'inventory',
      owner: 'Used-car manager',
      store: ['GSA-001'],
    })
  })

  it('drops an unrecognised value rather than emptying the queue', () => {
    /*
     * A stale link with `?severity=urgent` should show everything. Showing NOTHING would
     * read as "no conditions found", which is a different and false statement.
     */
    const facets = parseActionFacets({ severity: 'urgent', domain: 'weather' }, STORE_IDS)
    expect(facets.severity).toBeNull()
    expect(facets.domain).toBeNull()
    expect(selectActions(ACTIONS, facets)).toHaveLength(ACTIONS.length)
  })

  it('drops a store the export does not carry', () => {
    const facets = parseActionFacets({ store: 'GSA-999,GSA-001' }, STORE_IDS)
    expect(facets.store).toEqual(['GSA-001'])
  })

  it('serialises canonically, so two equivalent selections share one URL', () => {
    const a = parseActionFacets({ store: 'GSA-002,GSA-001' }, STORE_IDS)
    const b = parseActionFacets({ store: 'GSA-001,GSA-002' }, STORE_IDS)
    expect(serializeActionFacets(a)).toBe(serializeActionFacets(b))
    expect(actionsHref(NO_FACETS)).toBe('/dashboard/actions')
  })

  it('round-trips through the URL', () => {
    const facets = parseActionFacets(
      { severity: 'medium', domain: 'accounting', owner: 'Controller', store: 'GSA-003' },
      STORE_IDS
    )
    const query = Object.fromEntries(new URLSearchParams(serializeActionFacets(facets)))
    expect(parseActionFacets(query, STORE_IDS)).toEqual(facets)
  })

  it('toggles a selected facet off', () => {
    const facets = parseActionFacets({ severity: 'high' }, STORE_IDS)
    expect(toggleFacetHref(facets, 'severity', 'high')).toBe('/dashboard/actions')
    expect(toggleFacetHref(facets, 'severity', 'medium')).toContain('severity=medium')
    expect(toggleStoreHref(facets, 'GSA-001')).toContain('store=GSA-001')
  })

  it('filters only by removing rows', () => {
    for (const severity of ACTION_SEVERITIES) {
      const selected = selectActions(ACTIONS, { ...NO_FACETS, severity })
      expect(selected.every((action) => action.severity === severity)).toBe(true)
      for (const action of selected) expect(ACTIONS).toContain(action)
    }
  })

  it('combines facets conjunctively', () => {
    const facets = { ...NO_FACETS, severity: 'high' as const, domain: 'inventory' as const }
    const selected = selectActions(ACTIONS, facets)
    expect(
      selected.every((a) => a.severity === 'high' && a.domain === 'inventory')
    ).toBe(true)
  })

  it('counts facets over the whole queue, not the filtered one', () => {
    /*
     * A count that fell to zero the moment its own facet was selected would answer no
     * question a reader has. The counts must say what selecting a DIFFERENT value shows.
     */
    const unfiltered = buildActionQueue(
      ACTIONS,
      NO_FACETS,
      STORE_LABELS,
      DOMAIN_LABELS,
      SEVERITY_LABELS
    )
    const filtered = buildActionQueue(
      ACTIONS,
      { ...NO_FACETS, severity: 'high' },
      STORE_LABELS,
      DOMAIN_LABELS,
      SEVERITY_LABELS
    )
    expect(filtered.severities).toEqual(unfiltered.severities.map((option) => ({
      ...option,
      selected: option.value === 'high',
    })))
    expect(filtered.total).toBe(ACTIONS.length)
    expect(filtered.shown).toBeLessThan(filtered.total)
  })

  it('derives the unfiltered counts the manifest published', () => {
    const view = buildActionQueue(
      ACTIONS,
      NO_FACETS,
      STORE_LABELS,
      DOMAIN_LABELS,
      SEVERITY_LABELS
    )
    for (const option of view.severities) {
      expect(dashboardManifest.actions.counts.bySeverity[option.value]).toBe(option.count)
    }
    for (const option of view.domains) {
      expect(dashboardManifest.actions.counts.byDomain[option.value]).toBe(option.count)
    }
  })

  it('supports an empty result without pretending it is a clean bill of health', () => {
    const impossible = { ...NO_FACETS, severity: 'low' as const, domain: 'leads' as const }
    const view = buildActionQueue(
      ACTIONS,
      impossible,
      STORE_LABELS,
      DOMAIN_LABELS,
      SEVERITY_LABELS
    )
    expect(view.actions).toEqual([])
    expect(view.total).toBe(ACTIONS.length)
  })
})

describe('the Executive block is a prefix of the queue', () => {
  it('takes the first N in queue order, with no second ranking', () => {
    const top = topActions(ACTIONS, 5)
    expect(top).toEqual(ACTIONS.slice(0, 5))
  })

  it('is deterministic across calls', () => {
    expect(topActions(ACTIONS, 5)).toEqual(topActions(ACTIONS, 5))
  })

  it('leads each row with the evidence field the RULE put first', () => {
    for (const action of topActions(ACTIONS, 5)) {
      expect(primaryEvidence(action)).toBe(action.evidence[0])
    }
  })
})

describe('the change drivers reconcile exactly', () => {
  const rows = grossChangeBridgeRows()
  const materiality = dashboardManifest.actions.changeDrivers.materiality
  const policy = { value: materiality.value, label: materiality.label }
  const asOfMonth = dashboardManifest.asOfDate.slice(0, 7)

  it('reads its threshold from the manifest rather than a literal', () => {
    expect(materiality.label.toLowerCase()).toContain('project default')
    expect(materiality.value).toMatch(/^\d+$/)
  })

  it('names only the components SQL enumerates', () => {
    expect(dashboardManifest.actions.changeDrivers.decompositionOrder).toEqual([
      'volume',
      'front_pvr',
      'back_pvr',
    ])
  })

  it('sums listed effects and the remainder to the period change, exactly', () => {
    for (const stores of [STORE_IDS, ['GSA-001'], ['GSA-002'], ['GSA-003']]) {
      const drivers = buildChangeDrivers(buildBridge(rows, stores, asOfMonth), policy)
      expect(drivers.kind).toBe('available')
      if (drivers.kind !== 'available') continue
      const summed = sumExact(drivers.effects.map((effect) => effect.amount))
      expect(exactToString(summed)).toBe(exactToString(drivers.change))
      expect(drivers.reconciles).toBe(true)
    }
  })

  it('groups an immaterial effect rather than dropping it', () => {
    /*
     * A threshold far above every effect forces the whole change into the remainder. The
     * total must still be the total: this is the case where a "drop the small ones"
     * implementation would silently lose the entire decomposition.
     */
    const drivers = buildChangeDrivers(buildBridge(rows, STORE_IDS, asOfMonth), {
      value: '99999999',
      label: 'Everything is immaterial — project default',
    })
    expect(drivers.kind).toBe('available')
    if (drivers.kind !== 'available') return
    expect(drivers.effects).toHaveLength(1)
    expect(drivers.effects[0]?.grouped).toBe(true)
    expect(exactToString(drivers.effects[0]?.amount ?? drivers.change)).toBe(
      exactToString(drivers.change)
    )
    expect(drivers.reconciles).toBe(true)
  })

  it('lists every effect when nothing is immaterial', () => {
    const drivers = buildChangeDrivers(buildBridge(rows, STORE_IDS, asOfMonth), {
      value: '0',
      label: 'Nothing is immaterial — project default',
    })
    expect(drivers.kind).toBe('available')
    if (drivers.kind !== 'available') return
    const listed = drivers.effects.filter((effect) => !effect.grouped)
    expect(listed).toHaveLength(3)
    expect(drivers.reconciles).toBe(true)
  })

  it('groups by MAGNITUDE, so a large negative effect is never hidden', () => {
    const drivers = buildChangeDrivers(buildBridge(rows, ['GSA-001'], asOfMonth), policy)
    expect(drivers.kind).toBe('available')
    if (drivers.kind !== 'available') return
    const negatives = drivers.effects.filter(
      (effect) => !effect.grouped && effect.display.startsWith('-')
    )
    expect(negatives.length).toBeGreaterThan(0)
  })

  it('renders the honest unavailable state rather than a zero', () => {
    /*
     * The month before the window opens has no baseline. Reporting $0 would state that
     * nothing moved, which is a different claim from "this cannot be decomposed".
     */
    const drivers = buildChangeDrivers(buildBridge(rows, STORE_IDS, '2025-07'), policy)
    expect(drivers.kind).toBe('unavailable')
    if (drivers.kind !== 'unavailable') return
    expect(drivers.reason).toBeTruthy()
    expect(drivers.reason).not.toContain('$0')
  })

  it('is unavailable rather than empty when no month is selected', () => {
    const drivers = buildChangeDrivers(buildBridge(rows, STORE_IDS, null), policy)
    expect(drivers.kind).toBe('unavailable')
  })

  it('is unavailable for a store scope the bridge does not carry', () => {
    const drivers = buildChangeDrivers(buildBridge(rows, ['GSA-404'], asOfMonth), policy)
    expect(drivers.kind).toBe('unavailable')
  })

  it('states attribution and never cause', () => {
    const drivers = buildChangeDrivers(buildBridge(rows, STORE_IDS, asOfMonth), policy)
    expect(drivers.kind).toBe('available')
    if (drivers.kind !== 'available') return
    expect(drivers.statement).toContain('bridge attributes')
    for (const banned of ['caused', 'because', 'resulted from', 'led to', 'due to']) {
      expect(drivers.statement.toLowerCase()).not.toContain(banned)
    }
  })

  it('agrees with the sum of the per-store changes', () => {
    /*
     * Not a new aggregate: the group change is the sum of the store changes, which is what
     * the bridge itself publishes per store. This proves the panel is reading them rather
     * than re-deriving a group figure some other way.
     */
    const group = buildChangeDrivers(buildBridge(rows, STORE_IDS, asOfMonth), policy)
    const perStore = STORE_IDS.map((store) =>
      buildChangeDrivers(buildBridge(rows, [store], asOfMonth), policy)
    )
    expect(group.kind).toBe('available')
    if (group.kind !== 'available') return
    const summed = perStore
      .filter((state) => state.kind === 'available')
      .map((state) => (state.kind === 'available' ? state.change : null))
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .reduce((running, value) => addExact(running, value))
    expect(compareExact(summed, group.change)).toBe(0)
  })
})

describe('drill-through validation is real, not a regex over the string', () => {
  it('accepts the routes the console serves', () => {
    expect(drillThroughProblem('/dashboard/inventory?store=GSA-001&unit=VEH-0000103')).toBeNull()
    expect(drillThroughProblem('/dashboard/deals/SLE-00000001')).toBeNull()
    expect(drillThroughProblem('/dashboard/accounting?store=GSA-002')).toBeNull()
  })

  it('refuses a route that does not exist', () => {
    expect(drillThroughProblem('/dashboard/pricing')).toContain('not a current operating route')
    expect(drillThroughProblem('/dashboard')).toContain('not a current operating route')
  })

  it('refuses a parameter the destination does not read', () => {
    expect(drillThroughProblem('/dashboard/accounting?source=LDS-007')).toContain(
      'does not read source'
    )
    expect(drillThroughProblem('/dashboard/inventory?nonsense=1')).toContain(
      'does not read nonsense'
    )
  })

  it('refuses a parameter on a Deal Jacket, which filters nothing', () => {
    expect(drillThroughProblem('/dashboard/deals/SLE-00000001?store=GSA-001')).toContain(
      'filters nothing'
    )
  })

  it('refuses an empty value and a repeated key', () => {
    expect(drillThroughProblem('/dashboard/inventory?store=')).toContain('with no value')
    expect(drillThroughProblem('/dashboard/inventory?store=A&store=B')).toContain('repeats')
  })
})
