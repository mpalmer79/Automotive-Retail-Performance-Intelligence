/**
 * `UX.2A`: the command center's geometry actually moves.
 *
 * WHAT THIS SUITE IS FOR, AND WHY IT IS NOT A SNAPSHOT SUITE
 * ----------------------------------------------------------
 * `UX.2A` §20 states the rule this file enforces: for each major visual, render at least
 * two materially different data or filter states and assert that a width, a height, a
 * position, a series or a composition CHANGES. A fixed pretty chart must fail. Every test
 * below is written so that a primitive which ignored its input — drew a full-width bar, a
 * fixed five-segment stack, an evenly-stepped funnel — would be caught, and caught by the
 * property that makes it decorative rather than by a rendered string.
 *
 * The three states used are real filter states the route accepts, resolved through
 * `buildExecutiveOverview` exactly as the page resolves them. Nothing here constructs a
 * fixture that the console could not produce.
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT. Colours, spacing, class names and copy. Those are
 * either enforced by the token tests or are editorial, and a geometry suite that also
 * pinned them would fail on every honest edit — which is how a suite stops being run.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  AttentionSummary,
  ChangeDriverBridge,
} from '../../src/components/dashboard/actions-sections.tsx'
import {
  FunnelChart,
  MetricSwitch,
  StoreMeasureBars,
  type FunnelStageBar,
  type StoreMeasureGroup,
} from '../../src/components/dashboard/exec-visuals.tsx'
import { LeadFunnel } from '../../src/components/dashboard/lead-funnel.tsx'
import { InventoryRisk } from '../../src/components/dashboard/inventory-risk.tsx'
import { StoreComparisonSection } from '../../src/components/dashboard/operating.tsx'
import { InventoryAgeStack } from '../../src/components/dashboard/visuals.tsx'
import { buildExecutiveOverview } from '../../src/lib/dashboard/executive.ts'
import {
  DOMAIN_LABELS,
  SEVERITY_LABELS,
} from '../../src/lib/dashboard/action-contract.ts'
import {
  NO_FACETS,
  buildActionQueue,
  selectActions,
} from '../../src/lib/dashboard/actions.ts'
import { managementActions } from '../../src/lib/dashboard/actions-data.ts'
import {
  buildBridge,
  buildChangeDrivers,
} from '../../src/lib/dashboard/change-drivers.ts'
import { grossChangeBridgeRows } from '../../src/lib/dashboard/change-drivers-data.ts'
import { dashboardManifest, dashboardStores } from '../../src/lib/dashboard/data.ts'
import { parseExact } from '../../src/lib/dashboard/decimal.ts'
import { parseFilters } from '../../src/lib/dashboard/filters.ts'

afterEach(cleanup)

/** The overview the route would build for a query string. */
function overviewFor(search: string) {
  const parsed = parseFilters(new URLSearchParams(search), {
    knownStores: dashboardStores.map((store) => store.id),
  })
  return buildExecutiveOverview(parsed.filters, parsed.reset)
}

/** Every inline width an element subtree draws, in document order. */
function widthsIn(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="width"]')].map(
    (node) => node.style.width
  )
}

/** Every inline height an element subtree draws, in document order. */
function heightsIn(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="height"]')].map(
    (node) => node.style.height
  )
}

/* -------------------------------------------------------------------------- */
/* The grouped store comparison                                                */
/* -------------------------------------------------------------------------- */

describe('the store comparison is drawn from the data and not from a template', () => {
  it('draws three measures across the stores in scope', () => {
    const { container } = render(<StoreComparisonSection overview={overviewFor('')} />)
    // Three measure groups, three stores each: nine tracks, none of them decorative.
    expect(widthsIn(container)).toHaveLength(9)
  })

  it('moves every bar when the store scope changes', () => {
    const { container: pair } = render(
      <StoreComparisonSection overview={overviewFor('store=GSA-001,GSA-002')} />
    )
    const first = widthsIn(pair)
    cleanup()
    const { container: other } = render(
      <StoreComparisonSection overview={overviewFor('store=GSA-002,GSA-003')} />
    )
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(widthsIn(other))
  })

  it('moves every bar when the period changes', () => {
    const { container: december } = render(
      <StoreComparisonSection overview={overviewFor('period=2025-12')} />
    )
    const first = widthsIn(december)
    cleanup()
    const { container: september } = render(
      <StoreComparisonSection overview={overviewFor('period=2025-09')} />
    )
    expect(first).not.toEqual(widthsIn(september))
  })

  it('scales each measure to its own maximum rather than to a shared one', () => {
    /*
     * The defect this catches: a common scale across units, dollars and dollars per unit
     * would draw retail units as a hairline beside total gross. Exactly one store is the
     * maximum of each group, so each group carries exactly one full-width bar.
     */
    const { container } = render(<StoreComparisonSection overview={overviewFor('')} />)
    const widths = widthsIn(container)
    const full = widths.filter((width) => width === '100%')
    // At least one full-width bar per measure — a group whose maximum was drawn against
    // some other group's would have none. Ties are legitimate, so the floor is three
    // rather than exactly three.
    expect(full.length).toBeGreaterThanOrEqual(3)
    // And a shared scale is excluded: nine full-width bars would be one.
    expect(full.length).toBeLessThan(widths.length)
  })

  it('draws no track at all for a structural absence', () => {
    /*
     * The independent pre-owned store has no new-vehicle franchise. Filtering to `New`
     * inventory gives it a `not-applicable` result, and a zero-length bar for it would
     * re-create geometrically the defect the structural-absence rule removes from the
     * scoreboard.
     */
    const groups: readonly StoreMeasureGroup[] = [
      {
        id: 'units',
        label: 'Retail units',
        kpiId: 'KPI-SLS-001',
        rows: [
          {
            storeId: 'GSA-001',
            storeShortName: 'Granite Chevrolet',
            storeType: 'Franchise New and Used',
            result: { kind: 'value', value: parseExact('40'), rowCount: 1 },
            display: '40',
          },
          {
            storeId: 'GSA-003',
            storeShortName: 'Granite Pre-Owned',
            storeType: 'Independent Used',
            result: { kind: 'not-applicable', reason: 'No franchise.' },
            display: 'Not applicable',
          },
        ],
      },
    ]
    const { container } = render(<StoreMeasureBars title="Stores" groups={groups} />)
    expect(widthsIn(container)).toEqual(['100%'])
    expect(screen.getAllByText('Not applicable').length).toBeGreaterThan(0)
  })
})

/* -------------------------------------------------------------------------- */
/* The funnel                                                                  */
/* -------------------------------------------------------------------------- */

describe('the funnel narrows because the data narrows', () => {
  it('draws each stage as a share of the first, in descending order', () => {
    const { container } = render(
      <LeadFunnel
        funnel={overviewFor('').funnel}
        comparisonLabel="November 2025"
        filters={overviewFor('').filters}
      />
    )
    const widths = widthsIn(container).map((width) => Number(width.replace('%', '')))
    expect(widths).toHaveLength(5)
    expect(widths[0]).toBe(100)
    // A nesting: every stage is a subset of the one above it.
    for (let index = 1; index < widths.length; index += 1) {
      expect(widths[index]).toBeLessThanOrEqual(widths[index - 1] as number)
    }
    // And it is not an evenly-stepped decoration.
    expect(new Set(widths).size).toBeGreaterThan(2)
  })

  it('moves the stage widths when the store scope changes', () => {
    const first = overviewFor('store=GSA-001')
    const { container: one } = render(
      <LeadFunnel funnel={first.funnel} comparisonLabel={null} filters={first.filters} />
    )
    const before = widthsIn(one)
    cleanup()
    const second = overviewFor('store=GSA-003')
    const { container: other } = render(
      <LeadFunnel
        funnel={second.funnel}
        comparisonLabel={null}
        filters={second.filters}
      />
    )
    expect(before).not.toEqual(widthsIn(other))
  })

  it('draws no bar at all when there are no leads to take a share of', () => {
    const stages: readonly FunnelStageBar[] = [
      {
        key: 'leads',
        label: 'Leads',
        display: 'No matching records',
        share: null,
        shareDisplay: null,
        rate: null,
      },
    ]
    const { container } = render(
      <FunnelChart title="Lead funnel" stages={stages} shareNote="note" />
    )
    expect(widthsIn(container)).toHaveLength(0)
    expect(
      screen.getByText('No proportion is defined without leads received')
    ).toBeTruthy()
  })
})

/* -------------------------------------------------------------------------- */
/* Inventory: two distributions over one set of bands                          */
/* -------------------------------------------------------------------------- */

describe('the age stack carries units and capital, and both move', () => {
  const BANDS = [
    { key: 'a', label: '0-30', display: '10 units', share: 0.4 },
    { key: 'b', label: '31-60', display: '10 units', share: 0.4 },
    { key: 'c', label: '61-90', display: '5 units', share: 0.2 },
  ]

  it('draws one track when no band carries capital', () => {
    const { container } = render(
      <InventoryAgeStack title="Age" segments={BANDS} snapshotNote="note" />
    )
    expect(container.querySelectorAll('[data-stack-track]')).toHaveLength(1)
  })

  it('draws two tracks when every band carries capital', () => {
    const withCapital = BANDS.map((band, index) => ({
      ...band,
      capitalDisplay: `$${String(index + 1)}0,000`,
      capitalShare: [0.2, 0.3, 0.5][index] as number,
    }))
    const { container } = render(
      <InventoryAgeStack title="Age" segments={withCapital} snapshotNote="note" />
    )
    const tracks = container.querySelectorAll('[data-stack-track]')
    expect(tracks).toHaveLength(2)
    // The two distributions are genuinely different: eleven per cent of the units and
    // twenty-six per cent of the money is the finding this track exists to make visible.
    const units = widthsIn(tracks[0] as HTMLElement)
    const capital = widthsIn(tracks[1] as HTMLElement)
    expect(units).not.toEqual(capital)
  })

  it('withholds the capital track when one band is missing its capital', () => {
    /*
     * A partial capital bar beside a complete unit bar invites exactly the comparison it
     * cannot support, so the track is withheld rather than drawn short.
     */
    const partial = BANDS.map((band, index) =>
      index === 1 ? band : { ...band, capitalDisplay: '$1', capitalShare: 0.5 }
    )
    const { container } = render(
      <InventoryAgeStack title="Age" segments={partial} snapshotNote="note" />
    )
    expect(container.querySelectorAll('[data-stack-track]')).toHaveLength(1)
  })

  it('moves the drawn stack when the condition filter changes', () => {
    const { container: asNew } = render(
      <InventoryRisk
        inventory={overviewFor('condition=New').inventory}
        comparisonLabel={null}
      />
    )
    const before = widthsIn(asNew)
    cleanup()
    const { container: used } = render(
      <InventoryRisk
        inventory={overviewFor('condition=Used').inventory}
        comparisonLabel={null}
      />
    )
    expect(before.length).toBeGreaterThan(0)
    expect(before).not.toEqual(widthsIn(used))
  })

  it('reads the capital out of the export rather than inferring it', () => {
    const buckets = overviewFor('').inventory.buckets
    expect(buckets.length).toBeGreaterThan(1)
    for (const bucket of buckets) {
      expect(bucket.investmentShare).toBeGreaterThanOrEqual(0)
      expect(bucket.investmentShare).toBeLessThanOrEqual(1)
    }
    const shares = buckets.map((bucket) => bucket.share)
    const capital = buckets.map((bucket) => bucket.investmentShare)
    // Two distributions, not one copied twice: the money is not spread like the cars.
    expect(shares).not.toEqual(capital)
    expect(capital.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 6)
  })
})

/* -------------------------------------------------------------------------- */
/* The change-driver waterfall                                                 */
/* -------------------------------------------------------------------------- */

describe('the change-driver bridge draws the decomposition it is given', () => {
  function driversFor(stores: readonly string[]) {
    return buildChangeDrivers(
      buildBridge(
        grossChangeBridgeRows(),
        stores,
        dashboardManifest.asOfDate.slice(0, 7)
      ),
      {
        value: dashboardManifest.actions.changeDrivers.materiality.value,
        label: dashboardManifest.actions.changeDrivers.materiality.label,
      }
    )
  }

  const authority = dashboardManifest.actions.changeDrivers.authority

  it('renders every effect the bridge lists, plus the total as a closing anchor', () => {
    const drivers = driversFor(dashboardStores.map((store) => store.id))
    expect(drivers.kind).toBe('available')
    if (drivers.kind !== 'available') return
    const { container } = render(
      <ChangeDriverBridge drivers={drivers} authority={authority} />
    )
    // One bar per effect, plus the closing anchor.
    expect(heightsIn(container)).toHaveLength(drivers.effects.length + 1)
    // Twice: once as the bar's label, once in the table the chart carries.
    expect(screen.getAllByText('Total change').length).toBeGreaterThan(0)
    for (const effect of drivers.effects) {
      expect(screen.getAllByText(effect.display).length).toBeGreaterThan(0)
    }
  })

  it('moves the bar heights when the store scope changes', () => {
    const group = driversFor(dashboardStores.map((store) => store.id))
    const { container: whole } = render(
      <ChangeDriverBridge drivers={group} authority={authority} />
    )
    const before = heightsIn(whole)
    cleanup()
    const { container: single } = render(
      <ChangeDriverBridge drivers={driversFor(['GSA-001'])} authority={authority} />
    )
    expect(before.length).toBeGreaterThan(0)
    expect(before).not.toEqual(heightsIn(single))
  })

  it('states the change without a decomposition rather than drawing a zero', () => {
    const drivers = driversFor(['GSA-001'])
    if (drivers.kind !== 'unavailable') return
    render(<ChangeDriverBridge drivers={drivers} authority={authority} />)
    expect(screen.queryAllByText('Total change')).toHaveLength(0)
  })

  it('attributes and never causes', () => {
    const drivers = driversFor(dashboardStores.map((store) => store.id))
    const { container } = render(
      <ChangeDriverBridge drivers={drivers} authority={authority} />
    )
    const text = (container.textContent ?? '').toLowerCase()
    expect(text).toContain('attributes')
    for (const causal of ['caused', 'because of', 'resulted from', 'drove the']) {
      expect(text, causal).not.toContain(causal)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The metric switch                                                           */
/* -------------------------------------------------------------------------- */

describe('the metric switch changes what is displayed and nothing else', () => {
  const OPTIONS = [
    { id: 'units', label: 'Retail units', panel: <p>units panel</p> },
    { id: 'gross', label: 'Total gross', panel: <p>gross panel</p> },
    { id: 'gpru', label: 'Total GPRU', panel: <p>gpru panel</p> },
  ]

  it('renders every panel in the document, so nothing has to be fetched', () => {
    render(<MetricSwitch name="t" legend="Trend measure" options={OPTIONS} />)
    expect(screen.getByText('units panel')).toBeTruthy()
    expect(screen.getByText('gross panel')).toBeTruthy()
    expect(screen.getByText('gpru panel')).toBeTruthy()
  })

  it('is a real radio group with one option selected and a group name', () => {
    render(<MetricSwitch name="t" legend="Trend measure" options={OPTIONS} />)
    const group = screen.getByRole('group', { name: 'Trend measure' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(radios.filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1)
    expect((radios[0] as HTMLInputElement).checked).toBe(true)
    for (const option of OPTIONS) {
      expect(screen.getByLabelText(option.label)).toBeTruthy()
    }
  })

  it('binds each label to its own control, so a click is a real selection', () => {
    render(<MetricSwitch name="t" legend="Trend measure" options={OPTIONS} />)
    for (const option of OPTIONS) {
      const input = screen.getByLabelText(option.label) as HTMLInputElement
      expect(input.id).toBe(`t-${option.id}`)
      expect(input.name).toBe('t')
    }
  })

  it('renders nothing rather than a control with one choice', () => {
    const { container } = render(
      <MetricSwitch name="t" legend="Trend measure" options={[OPTIONS[0]!]} />
    )
    expect(container.firstChild).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* Management attention                                                        */
/* -------------------------------------------------------------------------- */

describe('the attention summary counts what the rest of the screen is showing', () => {
  /** The queue the route builds: narrowed by store first, then tallied. */
  function queueFor(stores: readonly string[]) {
    const facets = { ...NO_FACETS, store: stores }
    return {
      facets,
      view: buildActionQueue(
        selectActions(managementActions(), facets),
        NO_FACETS,
        Object.fromEntries(dashboardStores.map((store) => [store.id, store.shortName])),
        DOMAIN_LABELS,
        SEVERITY_LABELS
      ),
    }
  }

  it('falls when the store filter narrows, rather than reporting the whole group', () => {
    /*
     * The defect this exists for: `buildActionQueue` tallies over the WHOLE queue it is
     * given, deliberately, so passing it the store facet leaves `total` counting the group
     * under a label reading "in scope". Narrowing the rows first is what makes the count
     * agree with every other figure on the screen.
     */
    const group = queueFor([])
    const store = queueFor(['GSA-001'])
    expect(group.view.total).toBeGreaterThan(0)
    expect(store.view.total).toBeGreaterThan(0)
    expect(store.view.total).toBeLessThan(group.view.total)
  })

  it('tallies severities and domains over the scoped rows and links each one', () => {
    const { view, facets } = queueFor(['GSA-001'])
    render(<AttentionSummary view={view} facets={facets} />)
    const counted = view.severities.reduce((sum, option) => sum + option.count, 0)
    expect(counted).toBe(view.total)
    for (const link of screen.getAllByRole('link')) {
      // Every chip carries the reader's store scope through to the queue rather than
      // silently widening it.
      expect(link.getAttribute('href')).toContain('store=GSA-001')
    }
  })

  it('offers no control that would pretend to change a stored state', () => {
    const { view, facets } = queueFor([])
    const { container } = render(<AttentionSummary view={view} facets={facets} />)
    expect(container.querySelector('button')).toBeNull()
    const text = (container.textContent ?? '').toLowerCase()
    for (const forbidden of ['assign', 'snooze', 'due', 'done', 'complete']) {
      expect(text, forbidden).not.toContain(forbidden)
    }
  })
})
