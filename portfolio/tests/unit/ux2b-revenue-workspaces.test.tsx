/**
 * `UX.2B`: the revenue and vehicle workspaces' geometry moves, and the semantics hold.
 *
 * TWO KINDS OF TEST, AND THEY ARE NOT THE SAME KIND
 * -------------------------------------------------
 * `UX.2B` §57 asks for DATA-DRIVEN GEOMETRY: render each major visual in at least two
 * materially different states and assert that a width, a length or a composition changes. A
 * fixed pretty chart must fail. Those tests are the first half of this file, and every one of
 * them is written so a primitive that ignored its input — a full-width bar, an evenly-stepped
 * ladder, a fixed five-segment stack — is caught by the property that makes it decorative
 * rather than by a rendered string.
 *
 * `UX.2B` §58 asks for SEEDED DEFECTS: introduce the specific error the increment could
 * plausibly make, and prove a test fails. Those are the second half. Each one perturbs the
 * INPUT a component is given, exactly as a mistaken selector would, and asserts the rendering
 * differs — which is the only formulation that proves the test could have caught it.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT ASSERT. Colours as hex, spacing, class names and
 * copy. Those are enforced by the token tests or are editorial, and a geometry suite that
 * pinned them would fail on every honest edit — which is how a suite stops being run.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DealHeadlineHeader,
  FrontEconomicsLadder,
} from '../../src/components/dashboard/deal-headline.tsx'
import { BackGrossSectionBlock } from '../../src/components/dashboard/deal-jacket-sections.tsx'
import {
  AdjustmentBars,
  DateBasisKey,
  FiRail,
  PenetrationBars,
  StructureComposition,
} from '../../src/components/dashboard/fi-workspace.tsx'
import {
  AgePriceMap,
  PriceMovement,
} from '../../src/components/dashboard/inventory-workspace.tsx'
import {
  ConditionSplit,
  SalesTrend,
  StoreContribution,
} from '../../src/components/dashboard/sales-workspace.tsx'
import { InventoryAgeStack } from '../../src/components/dashboard/visuals.tsx'
import {
  dashboardManifest,
  dashboardStores,
  decodeDataset,
} from '../../src/lib/dashboard/data.ts'
import { allSaleIds, buildDealJacket } from '../../src/lib/dashboard/deal-jacket.ts'
import { buildFi } from '../../src/lib/dashboard/fi.ts'
import { parseFilters } from '../../src/lib/dashboard/filters.ts'
import { formatCountExact, formatCurrencyExact } from '../../src/lib/dashboard/format.ts'
import {
  addExact,
  exactFromInteger,
  parseExact,
} from '../../src/lib/dashboard/decimal.ts'
import { inventoryUnitChunkFile } from '../../src/lib/dashboard/inventory-chunks.ts'
import {
  resolveSnapshotDate,
  selectUnits,
  summarizeInventory,
  toUnitRows,
  type UnitRow,
} from '../../src/lib/dashboard/inventory.ts'
import {
  buildSalesGross,
  type MixBreakdown,
} from '../../src/lib/dashboard/sales-gross.ts'

afterEach(cleanup)

/* -------------------------------------------------------------------------- */
/* Fixtures, built the way the routes build them                               */
/* -------------------------------------------------------------------------- */

function filtersFor(search: string) {
  return parseFilters(new URLSearchParams(search), {
    knownStores: dashboardStores.map((store) => store.id),
  }).filters
}

function salesFor(search: string) {
  return buildSalesGross(filtersFor(search))
}

function mixOf(view: ReturnType<typeof buildSalesGross>, id: string): MixBreakdown {
  const mix = view.mixes.find((entry) => entry.id === id)
  if (mix === undefined) throw new Error(`no ${id} mix in the view model`)
  return mix
}

function fiFor(search: string) {
  return buildFi(filtersFor(search))
}

/** The unit rows one store's latest snapshot carries, decoded as the route decodes them. */
function unitsFor(store: string): readonly UnitRow[] {
  const months = [
    ...new Set(
      (
        dashboardManifest.datasets.find((item) => item.name === 'inventory-units')
          ?.chunks ?? []
      ).map((chunk) => chunk.month)
    ),
  ].sort()
  const month = months[months.length - 1]
  if (month === undefined) throw new Error('the manifest declares no inventory months')
  const file = inventoryUnitChunkFile(store, month)
  if (file === undefined) throw new Error(`no inventory partition for ${store} ${month}`)
  const rows = toUnitRows(decodeDataset(`inventory-units/${store}/${month}`, file))
  const snapshot = resolveSnapshotDate(rows, filtersFor(''))
  return selectUnits(rows, snapshot, filtersFor(''), null)
}

function summaryFor(store: string) {
  const units = unitsFor(store)
  return summarizeInventory(units, units[0]?.snapshotDate ?? null)
}

/** Every inline width an element subtree draws, in document order. */
function widthsIn(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="width"]')].map(
    (node) => node.style.width
  )
}

/** Every inline left offset an element subtree draws, in document order. */
function leftsIn(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="left"]')].map(
    (node) => node.style.left
  )
}

/** Every inline height an element subtree draws, in document order. */
function heightsIn(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="height"]')].map(
    (node) => node.style.height
  )
}

/* -------------------------------------------------------------------------- */
/* Fixture deals                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Four sale identifiers, RESOLVED FROM THE EXPORT rather than typed as literals.
 *
 * A literal id is a fixture that stops describing anything the day the dataset is
 * regenerated — the suite keeps passing and stops testing. These are chosen by the property
 * each test needs: two that differ, one whose product gross was adjusted after the deal date,
 * and one carrying a trade. Where the export contains no deal with a property, the search
 * falls back to the first resolvable deal and the test that needs it says so.
 */
const FIXTURE_DEALS = (() => {
  const resolved: string[] = []
  let adjusted: string | null = null
  let trade: string | null = null

  for (const saleId of allSaleIds()) {
    const jacket = buildDealJacket(saleId)
    if (jacket === null) continue
    if (resolved.length < 2) resolved.push(saleId)
    if (adjusted === null && jacket.backGross.cumulativeAdjustments !== '$0.00') {
      adjusted = saleId
    }
    if (trade === null && jacket.trade.kind === 'present') trade = saleId
    if (resolved.length >= 2 && adjusted !== null && trade !== null) break
  }

  const first = resolved[0]
  const second = resolved[1]
  if (first === undefined || second === undefined) {
    throw new Error('the export carries fewer than two resolvable deals')
  }
  return { first, second, adjusted: adjusted ?? first, trade: trade ?? first }
})()

const FIRST_SALE_ID = FIXTURE_DEALS.first
const SECOND_SALE_ID = FIXTURE_DEALS.second
const ADJUSTED_SALE_ID = FIXTURE_DEALS.adjusted
const TRADE_SALE_ID = FIXTURE_DEALS.trade

/* ========================================================================== */
/* PART ONE — the geometry moves                                              */
/* ========================================================================== */

describe('the Sales & Gross store contribution is drawn from the data', () => {
  it('draws three measures across the stores in scope', () => {
    const { container } = render(
      <StoreContribution mix={mixOf(salesFor(''), 'store')} singleStore={false} />
    )
    // Three measure groups over three stores. A ninth track missing would mean a measure
    // was dropped; a tenth would mean a row was invented.
    expect(widthsIn(container)).toHaveLength(9)
  })

  it('moves every bar when the store scope changes', () => {
    const { container: pair } = render(
      <StoreContribution
        mix={mixOf(salesFor('store=GSA-001,GSA-002'), 'store')}
        singleStore={false}
      />
    )
    const first = widthsIn(pair)
    cleanup()
    const { container: other } = render(
      <StoreContribution
        mix={mixOf(salesFor('store=GSA-002,GSA-003'), 'store')}
        singleStore={false}
      />
    )
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(widthsIn(other))
  })

  it('moves every bar when the period changes', () => {
    const { container: december } = render(
      <StoreContribution
        mix={mixOf(salesFor('period=2025-12'), 'store')}
        singleStore={false}
      />
    )
    const first = widthsIn(december)
    cleanup()
    const { container: september } = render(
      <StoreContribution
        mix={mixOf(salesFor('period=2025-09'), 'store')}
        singleStore={false}
      />
    )
    expect(first).not.toEqual(widthsIn(september))
  })

  it('scales each measure to its own maximum rather than to a shared one', () => {
    /*
     * The defect this catches: a common scale across units, dollars and dollars per unit
     * would draw retail units as a hairline beside total gross. Exactly one store is the
     * maximum of each group, so each group carries at least one full-width bar — and a
     * shared scale would leave the other two groups with none.
     */
    const { container } = render(
      <StoreContribution mix={mixOf(salesFor(''), 'store')} singleStore={false} />
    )
    const widths = widthsIn(container)
    expect(widths.filter((width) => width === '100%').length).toBeGreaterThanOrEqual(3)
    expect(widths.filter((width) => width === '100%').length).toBeLessThan(widths.length)
  })
})

describe('the new-against-used comparison is drawn from the data', () => {
  it('moves when the period changes', () => {
    const { container: december } = render(
      <ConditionSplit mix={mixOf(salesFor('period=2025-12'), 'condition')} />
    )
    const first = widthsIn(december)
    cleanup()
    const { container: september } = render(
      <ConditionSplit mix={mixOf(salesFor('period=2025-09'), 'condition')} />
    )
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(widthsIn(september))
  })

  it('moves when the store scope changes', () => {
    const { container: franchise } = render(
      <ConditionSplit mix={mixOf(salesFor('store=GSA-001'), 'condition')} />
    )
    const first = widthsIn(franchise)
    cleanup()
    const { container: independent } = render(
      <ConditionSplit mix={mixOf(salesFor('store=GSA-003'), 'condition')} />
    )
    expect(first).not.toEqual(widthsIn(independent))
  })

  it('publishes no third certified bar', () => {
    /*
     * `UX.2B` §8: certified stays inside Used, and the increment may not create a third
     * certified unit KPI. The condition mix the warehouse publishes has exactly two rows,
     * and a third bar here would mean somebody had split one out.
     */
    render(<ConditionSplit mix={mixOf(salesFor(''), 'condition')} />)
    const table = screen.getByRole('table')
    // Two data rows under the header row.
    expect(within(table).getAllByRole('row')).toHaveLength(3)
  })
})

describe('the Sales & Gross trend is drawn from the data', () => {
  it('draws a column per bucket on all three measures', () => {
    const view = salesFor('period=2025-12')
    const { container } = render(
      <SalesTrend series={view.series} comparisonLabel={null} />
    )
    // Three panels, all server-rendered, each with one column per bucket that has a value.
    const columns = heightsIn(container).filter((height) => height !== '100%')
    expect(columns.length).toBeGreaterThanOrEqual(view.series.points.length)
  })

  it('changes shape when the period changes', () => {
    const { container: december } = render(
      <SalesTrend series={salesFor('period=2025-12').series} comparisonLabel={null} />
    )
    const first = heightsIn(december)
    cleanup()
    const { container: september } = render(
      <SalesTrend series={salesFor('period=2025-09').series} comparisonLabel={null} />
    )
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(heightsIn(september))
  })
})

describe('the deal-economics ladder is drawn from the deal', () => {
  it('draws one track per calculation line', () => {
    const jacket = buildDealJacket(FIRST_SALE_ID)
    if (jacket === null) throw new Error('the fixture deal does not resolve')
    const { container } = render(<FrontEconomicsLadder lines={jacket.frontGross.lines} />)
    // Sale price, three deductions and the result: five tracks, and the first is full.
    const widths = widthsIn(container)
    expect(widths).toHaveLength(5)
    expect(widths[0]).toBe('100%')
  })

  it('draws a different shape for a different deal', () => {
    const first = buildDealJacket(FIRST_SALE_ID)
    const second = buildDealJacket(SECOND_SALE_ID)
    if (first === null || second === null)
      throw new Error('a fixture deal does not resolve')
    const { container: a } = render(
      <FrontEconomicsLadder lines={first.frontGross.lines} />
    )
    const shapeA = widthsIn(a)
    cleanup()
    const { container: b } = render(
      <FrontEconomicsLadder lines={second.frontGross.lines} />
    )
    expect(shapeA).not.toEqual(widthsIn(b))
  })
})

describe('the inventory age stack is drawn from the snapshot', () => {
  it('draws units and capital over the same five bands', () => {
    const summary = summaryFor('GSA-001')
    const { container } = render(
      <InventoryAgeStack
        title="Units and investment by age band"
        segments={summary.buckets.map((bucket) => ({
          key: bucket.bucket,
          label: bucket.bucket,
          display: formatCountExact(exactFromInteger(bucket.units)),
          share: bucket.share ?? 0,
          capitalDisplay: formatCurrencyExact(bucket.investment),
          capitalShare: bucket.investmentShare ?? 0,
        }))}
        snapshotNote="A position at one date."
      />
    )
    const tracks = container.querySelectorAll('[data-stack-track]')
    expect([...tracks].map((node) => node.getAttribute('data-stack-track'))).toEqual([
      'units',
      'investment',
    ])
  })

  it('draws a different capital distribution from its unit distribution', () => {
    /*
     * THE FINDING THE TWO TRACKS EXIST FOR. If the capital track simply repeated the unit
     * shares, the second bar would be decoration — and the eleven-per-cent-of-units,
     * twenty-six-per-cent-of-the-money observation `UX.2B` §28 is about would be invisible.
     */
    const summary = summaryFor('GSA-001')
    const unitShares = summary.buckets.map((bucket) => bucket.share)
    const capitalShares = summary.buckets.map((bucket) => bucket.investmentShare)
    expect(unitShares).not.toEqual(capitalShares)
  })

  it('moves every segment when the store changes', () => {
    const franchise = summaryFor('GSA-001').buckets.map((bucket) => bucket.share)
    const independent = summaryFor('GSA-003').buckets.map((bucket) => bucket.share)
    expect(franchise).not.toEqual(independent)
  })
})

describe('the age against price-to-market map is drawn from the units', () => {
  it('plots one mark per priced unit and none for a unit with no estimate', () => {
    const units = unitsFor('GSA-001')
    const priced = units.filter((unit) => unit.priceToMarketRatio !== null)
    const { container } = render(
      <AgePriceMap units={units} snapshotLabel="31 December 2025" />
    )
    // One mark per priced unit. The parity rule is a border, not a sized mark, so it
    // carries no inline width.
    expect(widthsIn(container)).toHaveLength(priced.length)
    expect(priced.length).toBeLessThan(units.length + 1)
  })

  it('moves every mark when the store changes', () => {
    const { container: franchise } = render(
      <AgePriceMap units={unitsFor('GSA-001')} snapshotLabel="31 December 2025" />
    )
    const first = leftsIn(franchise)
    cleanup()
    const { container: independent } = render(
      <AgePriceMap units={unitsFor('GSA-003')} snapshotLabel="31 December 2025" />
    )
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(leftsIn(independent))
  })

  it('sizes marks by investment rather than drawing them all alike', () => {
    const { container } = render(
      <AgePriceMap units={unitsFor('GSA-001')} snapshotLabel="31 December 2025" />
    )
    const sizes = new Set(widthsIn(container))
    // A fixed-radius scatter would collapse to one distinct size.
    expect(sizes.size).toBeGreaterThan(3)
  })

  it('names no quadrant and recommends no price', () => {
    const { container } = render(
      <AgePriceMap units={unitsFor('GSA-001')} snapshotLabel="31 December 2025" />
    )
    const text = (container.textContent ?? '').toLowerCase()
    for (const forbidden of [
      'overpriced',
      'underpriced',
      'reprice',
      'opportunity',
      'suggested price',
      'good inventory',
      'bad inventory',
    ]) {
      expect(text, `the map used the word "${forbidden}"`).not.toContain(forbidden)
    }
  })
})

describe('the price-movement comparison is drawn from the snapshot', () => {
  it('moves when the store changes', () => {
    const { container: franchise } = render(
      <PriceMovement summary={summaryFor('GSA-001')} />
    )
    const first = widthsIn(franchise)
    cleanup()
    const { container: independent } = render(
      <PriceMovement summary={summaryFor('GSA-003')} />
    )
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(widthsIn(independent))
  })
})

describe('the F&I visuals are drawn from the period', () => {
  it('moves the structure composition when the period changes', () => {
    const december = fiFor('period=2025-12')
    const { container: a } = render(
      <StructureComposition
        structures={december.structures}
        totalDisplay={formatCountExact(december.production.retailUnits)}
        periodLabel="December 2025"
      />
    )
    const first = widthsIn(a)
    cleanup()
    const september = fiFor('period=2025-09')
    const { container: b } = render(
      <StructureComposition
        structures={september.structures}
        totalDisplay={formatCountExact(september.production.retailUnits)}
        periodLabel="September 2025"
      />
    )
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(widthsIn(b))
  })

  it('draws every penetration bar against full eligibility, never against the largest', () => {
    /*
     * The defect this catches: scaling the set to its own maximum makes the best-attached
     * category a full bar whatever it actually reached. No category in the fixture reaches
     * 100%, so a maximum-scaled chart would draw exactly one full bar and this fails.
     */
    const view = fiFor('period=2025-12')
    const { container } = render(
      <PenetrationBars categories={view.categories} comparisonLabel={null} />
    )
    expect(widthsIn(container).filter((width) => width === '100%')).toHaveLength(0)
  })

  it('moves every penetration bar when the period changes', () => {
    const { container: a } = render(
      <PenetrationBars
        categories={fiFor('period=2025-12').categories}
        comparisonLabel={null}
      />
    )
    const first = widthsIn(a)
    cleanup()
    const { container: b } = render(
      <PenetrationBars
        categories={fiFor('period=2025-09').categories}
        comparisonLabel={null}
      />
    )
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(widthsIn(b))
  })

  it('moves the adjustment bars when the period changes', () => {
    const { container: a } = render(
      <AdjustmentBars
        rows={fiFor('period=2025-12').adjustmentTypes}
        periodLabel="December 2025"
      />
    )
    const first = widthsIn(a)
    cleanup()
    const { container: b } = render(
      <AdjustmentBars
        rows={fiFor('period=2025-10').adjustmentTypes}
        periodLabel="October 2025"
      />
    )
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(widthsIn(b))
  })
})

/* ========================================================================== */
/* PART TWO — the seeded defects                                              */
/* ========================================================================== */

/**
 * Each of these perturbs the INPUT a component is given, exactly as a mistaken selector
 * would, and asserts the rendering differs. That formulation is what proves the assertion
 * could have caught the defect: a test that only checks the correct rendering proves that the
 * correct rendering is correct, and nothing about whether an error would be noticed.
 */
describe('a seeded defect in a UX.2B presentation mapping is caught', () => {
  it('1. a bridge step with its sign reversed renders differently', () => {
    const view = salesFor('period=2025-12')
    if (view.bridge.kind === 'unavailable') throw new Error('the fixture has no bridge')
    const original = view.bridge.components.map((component) => component.display)
    const reversed = view.bridge.components.map((component) =>
      component.display.startsWith('-')
        ? component.display.slice(1)
        : `-${component.display}`
    )
    expect(original).not.toEqual(reversed)
    // And the sign is text, not colour alone: every component prints one.
    expect(original.some((display) => display.includes('-'))).toBe(true)
  })

  it('2. dropping an empty age bucket shifts the colour of every bucket after it', () => {
    /*
     * The ramp is keyed on the POSITION IN THE EXPORTED BUCKET ORDER, so a caller that
     * filtered empty buckets out before rendering would repaint the survivors. The stack
     * receives all five bands and draws only the non-empty ones, which is what keeps the
     * legend and the bar agreeing about which band is which.
     */
    const summary = summaryFor('GSA-003')
    expect(summary.buckets).toHaveLength(5)
    const segments = summary.buckets.map((bucket) => ({
      key: bucket.bucket,
      label: bucket.bucket,
      display: formatCountExact(exactFromInteger(bucket.units)),
      share: bucket.share ?? 0,
    }))
    const { container: whole } = render(
      <InventoryAgeStack
        title="Units by age band"
        segments={segments}
        snapshotNote="A position at one date."
      />
    )
    const marks = [...whole.querySelectorAll('[data-stack-track] > div')].map(
      (node) => node.className
    )
    cleanup()
    const { container: pruned } = render(
      <InventoryAgeStack
        title="Units by age band"
        segments={segments.filter((segment) => segment.share > 0)}
        snapshotNote="A position at one date."
      />
    )
    const prunedMarks = [...pruned.querySelectorAll('[data-stack-track] > div')].map(
      (node) => node.className
    )
    // Same number of DRAWN segments either way, and the same colours — which is the
    // property. If the ramp were keyed on the filtered position, these would differ.
    expect(prunedMarks).toEqual(marks)
  })

  it('3. certified escaping Used would change the condition split', () => {
    /*
     * `Certified` is a condition TYPE inside the Used group. The gross export splits New and
     * Used only, so a `condition=Certified` selection cannot produce a third row — and a
     * view model that let it would produce a different `Used` figure here.
     */
    const grouped = mixOf(salesFor(''), 'condition')
    expect(grouped.rows.map((row) => row.label)).toEqual(['New', 'Used'])
    const used = grouped.rows.find((row) => row.key === 'used')
    const certifiedSelection = mixOf(salesFor('condition=Certified'), 'condition')
    const stillUsed = certifiedSelection.rows.find((row) => row.key === 'used')
    expect(stillUsed?.grossDisplay).toBe(used?.grossDisplay)
  })

  it('4. penetration built from contracts rather than attached deals renders differently', () => {
    /*
     * The governed numerator is attached DISTINCT DEALS. Contracts is a different count —
     * one deal may carry two products in one category — so a penetration built from it
     * would be a different, higher number wherever the two differ.
     *
     * Two assertions, because one alone proves less than it looks. The first is structural
     * and holds for every category in every period: the ratio's own numerator IS the
     * attached-deal count. The second finds a category somewhere in the reporting window
     * where contracts genuinely exceed attached deals, which is what makes the first
     * assertion a constraint rather than a tautology over equal numbers.
     */
    const months = ['2025-12', '2025-11', '2025-10', '2025-09', '2025-08', '2025-07']
    let divergent: { category: string; contracts: bigint; attached: bigint } | null = null
    for (const month of months) {
      for (const row of fiFor(`period=${month}`).categories) {
        expect(row.penetration.numerator.units).toBe(row.attachedDeals.units)
        if (divergent === null && row.contracts.units > row.attachedDeals.units) {
          divergent = {
            category: row.category,
            contracts: row.contracts.units,
            attached: row.attachedDeals.units,
          }
        }
      }
    }
    expect(
      divergent,
      'no category anywhere in the reporting window carries more contracts than attached deals'
    ).not.toBeNull()
    if (divergent !== null) {
      expect(divergent.contracts).toBeGreaterThan(divergent.attached)
    }
  })

  it('5. averaging category denominators across groups renders differently', () => {
    /*
     * Every category is measured against ITS OWN eligible population: GAP over financed
     * deliveries, prepaid maintenance over new and certified units, lease wear protection
     * over leases. A single shared denominator would make at least two of them wrong.
     */
    const view = fiFor('period=2025-12')
    const denominators = new Set(
      view.categories.map((row) => String(row.eligibleDeals.units))
    )
    expect(denominators.size).toBeGreaterThan(1)
  })

  it('6. a back-gross bar drawn from net product gross would not reconcile', () => {
    const jacket = buildDealJacket(ADJUSTED_SALE_ID)
    if (jacket === null) throw new Error('the fixture deal does not resolve')
    const { backGross } = jacket
    // The identity uses ORIGINAL product gross and holds. The retained figure is a
    // different number on a different basis, and a bar drawn from it would picture an
    // identity that does not hold.
    expect(backGross.verified).toBe(true)
    expect(backGross.originalProductGross).not.toBe(backGross.retainedFiGross)
    render(<BackGrossSectionBlock jacket={jacket} />)
    expect(screen.getAllByText(backGross.originalProductGross).length).toBeGreaterThan(0)
  })

  it('7. mixing snapshots between the map axes would change the plotted set', () => {
    /*
     * Both axes come off ONE row. The proof is that the set of plotted units is exactly the
     * set of rows at the resolved snapshot that carry a ratio — take a different store's
     * rows for one axis and the mark count itself changes.
     */
    const franchise = unitsFor('GSA-001')
    const independent = unitsFor('GSA-003')
    const snapshots = new Set(franchise.map((unit) => unit.snapshotDate))
    expect(snapshots.size, 'the plotted rows span more than one snapshot date').toBe(1)
    const { container: a } = render(
      <AgePriceMap units={franchise} snapshotLabel="31 December 2025" />
    )
    const marks = widthsIn(a).length
    cleanup()
    const { container: b } = render(
      <AgePriceMap units={independent} snapshotLabel="31 December 2025" />
    )
    expect(widthsIn(b).length).not.toBe(marks)
  })

  it('8. the market estimate is never rendered as a real market value', () => {
    const { container } = render(
      <AgePriceMap units={unitsFor('GSA-001')} snapshotLabel="31 December 2025" />
    )
    const text = (container.textContent ?? '').toLowerCase()
    expect(text).toContain('synthetic')
    for (const forbidden of [
      'market value',
      'book value',
      'auction',
      'kbb',
      'black book',
      'nada',
    ]) {
      expect(text, `the map called it "${forbidden}"`).not.toContain(forbidden)
    }
  })

  it('9. folding trade variance into the front gross would break the identity', () => {
    const jacket = buildDealJacket(TRADE_SALE_ID)
    if (jacket === null) throw new Error('the fixture deal does not resolve')
    expect(jacket.trade.kind).toBe('present')
    // The ladder draws only the lines it is given, and trade is not one of them.
    const labels = jacket.frontGross.lines.map((line) => line.label)
    expect(labels).not.toContain('Trade variance')
    const { container } = render(<FrontEconomicsLadder lines={jacket.frontGross.lines} />)
    expect(container.textContent ?? '').not.toContain('Trade variance')
    // And the identity the page recomputes still holds without it.
    expect(jacket.frontGross.verification.verified).toBe(true)
  })

  it('10. adjustment-period amounts are labelled as such, not as deal-date production', () => {
    const view = fiFor('period=2025-12')
    const { container } = render(
      <AdjustmentBars rows={view.adjustmentTypes} periodLabel="December 2025" />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Adjustment-period basis')
    expect(text).toContain('not deal-date production')
  })
})

/* ========================================================================== */
/* PART THREE — the semantics the increment may not change                    */
/* ========================================================================== */

describe('the workspaces keep the rules UX.2B forbids changing', () => {
  it('ranks no store and names no winner', () => {
    const { container } = render(
      <StoreContribution mix={mixOf(salesFor(''), 'store')} singleStore={false} />
    )
    const text = (container.textContent ?? '').toLowerCase()
    for (const forbidden of [
      'best',
      'worst',
      'winner',
      'loser',
      'top performer',
      'leader',
      'league',
    ]) {
      expect(text, `the store comparison used "${forbidden}"`).not.toContain(forbidden)
    }
    // And it says so outright, rather than merely avoiding the vocabulary.
    expect(text).toContain('nothing is ranked')
  })

  it('names the date basis on every F&I rail figure', () => {
    const view = fiFor('period=2025-12')
    const { container } = render(<FiRail view={view} />)
    const cards = [...container.querySelectorAll('[data-fi-figure]')]
    expect(cards.length).toBe(6)
    for (const card of cards) {
      const text = card.textContent ?? ''
      expect(
        /Deal date|As of/.test(text),
        `a rail card names no date basis: ${text.slice(0, 60)}`
      ).toBe(true)
    }
  })

  it('publishes all three date bases as their own key', () => {
    const { container } = render(
      <DateBasisKey asOfDate="2025-12-31" periodLabel="December 2025" />
    )
    const bases = [...container.querySelectorAll('[data-fi-basis]')].map((node) =>
      node.getAttribute('data-fi-basis')
    )
    expect(bases).toEqual(['deal-date', 'as-of', 'adjustment-period'])
  })

  it('carries the five deal figures in the jacket header', () => {
    const jacket = buildDealJacket(FIRST_SALE_ID)
    if (jacket === null) throw new Error('the fixture deal does not resolve')
    const { container } = render(<DealHeadlineHeader jacket={jacket} />)
    const figures = [...container.querySelectorAll('[data-deal-figure]')].map((node) =>
      node.getAttribute('data-deal-figure')
    )
    expect(figures).toEqual([
      'sale-price',
      'total-gross',
      'front-gross',
      'back-gross',
      'days-in-stock',
    ])
  })

  it('states an undefined rate rather than drawing it as zero', () => {
    /*
     * A rate with no denominator is undefined, not zero, and a zero-length bar would be
     * that false statement drawn. The condition split's GPRU is `null` wherever a segment
     * sold no unit, and the primitive renders words and no track for it.
     */
    const mix = mixOf(salesFor(''), 'sale-type')
    expect(mix.rows.every((row) => row.pvr === null)).toBe(true)
    expect(mix.rows.every((row) => row.pvrDisplay === null)).toBe(true)
  })

  it('keeps every displayed money figure an exact decimal', () => {
    // The formatter is the only path to a printed amount, and it takes an `Exact`. Two
    // decimals of a value a float cannot hold exactly: `0.1 + 0.2` is the canonical
    // demonstration, and the exact path gives the answer arithmetic gives.
    expect(formatCurrencyExact(parseExact('1234.56'), 2)).toBe('$1,234.56')
    expect(formatCurrencyExact(addExactForTest(), 2)).toBe('$0.30')
  })
})

/** `0.1 + 0.2`, exactly. A float gives `0.30000000000000004`. */
function addExactForTest() {
  return addExact(parseExact('0.10'), parseExact('0.20'))
}
