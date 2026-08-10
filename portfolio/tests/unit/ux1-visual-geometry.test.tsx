/**
 * The `UX.1` geometry contract: every mark is a function of its data.
 *
 * WHAT THIS SUITE IS FOR, AND WHY IT IS NOT `dashboard-visuals`
 * ------------------------------------------------------------
 * `dashboard-visuals.test.tsx` asserts that nothing is available ONLY as a length:
 * every value a bar encodes is also text, the data table is in the document, a
 * null renders as a gap and a stated reason rather than as a zero. That is the
 * accessibility contract and it is the more important of the two.
 *
 * This suite asserts the other half, which nothing checked before: that the length
 * MOVES. A test that finds a `<div class="bar">` in the output passes just as
 * happily against a fixed decorative graphic, and `UX.1` is the increment that
 * made "the product's visual interest comes from data, never from decoration" a
 * stated design rule. A rule nothing can fail is a preference.
 *
 * THE METHOD
 * ----------
 * Render each primitive twice, against two MATERIALLY different datasets, and
 * compare the inline geometry it emits — the percentages it computes from the
 * values. The assertion is that the two renderings differ, and that rendering the
 * same data twice does not.
 *
 * The comparison is on the ordered SET of emitted style declarations rather than
 * on any particular number, deliberately. Asserting that a bar is 43.7% wide pins
 * an implementation detail and makes a legitimate rescale look like a regression.
 * Asserting that the profile changes when the data changes pins the contract and
 * nothing else.
 *
 * Inline `style` rather than computed style, because jsdom computes no layout: the
 * attribute is exactly what the component decided from the values, which is the
 * thing under test.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  BridgeChart,
  DistributionStrip,
  ExecutiveMicroTrend,
  InventoryAgeStack,
  StoreComparisonBars,
  TrendChart,
} from '../../src/components/dashboard/visuals.tsx'
import { parseExact } from '../../src/lib/dashboard/decimal.ts'
import type { Exact } from '../../src/lib/dashboard/decimal.ts'
import type { MetricResult } from '../../src/lib/dashboard/selectors.ts'

/** Every inline style declaration the rendered tree carries, in document order. */
function profile(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[style]')].map(
    (element) => element.getAttribute('style') ?? ''
  )
}

/** How many DISTINCT geometries a rendering draws. */
function distinct(container: HTMLElement): number {
  return new Set(profile(container)).size
}

function value(amount: string): MetricResult {
  return { kind: 'value', value: parseExact(amount), rowCount: 10 }
}

function point(index: number, amount: string | null) {
  return {
    key: `2025-${String(index).padStart(2, '0')}`,
    label: `Month ${String(index)}`,
    value: amount === null ? null : parseExact(amount),
    display: amount === null ? 'No eligible denominator' : `$${amount}`,
  }
}

function microPoint(index: number, amount: string, isCurrent = false) {
  return { ...point(index, amount), isCurrent }
}

function bridgeBar(
  key: string,
  label: string,
  amount: string,
  kind: 'anchor' | 'step'
): {
  key: string
  label: string
  value: Exact
  display: string
  kind: 'anchor' | 'step'
} {
  return { key, label, value: parseExact(amount), display: `$${amount}`, kind }
}

/* -------------------------------------------------------------------------- */
/* TrendChart                                                                  */
/* -------------------------------------------------------------------------- */

describe('the trend chart draws its columns from its values', () => {
  const flat = [point(1, '1000.00'), point(2, '1000.00'), point(3, '1000.00')]
  const varied = [point(1, '250.00'), point(2, '4000.00'), point(3, '1200.00')]

  const chart = (points: typeof flat) => (
    <TrendChart title="Total gross" measure="total gross" points={points} />
  )

  it('emits geometry at all, so the assertions below are not vacuous', () => {
    // The guard on the guard. If the collector ever stopped finding marks — a
    // refactor to CSS custom properties, say — every comparison in this file would
    // be between two empty arrays and would pass.
    expect(profile(render(chart(varied)).container).length).toBeGreaterThan(0)
  })

  it('is deterministic: the same data draws the same shape', () => {
    expect(profile(render(chart(varied)).container)).toEqual(
      profile(render(chart(varied)).container)
    )
  })

  it('draws a different shape for a different series', () => {
    expect(profile(render(chart(varied)).container)).not.toEqual(
      profile(render(chart(flat)).container)
    )
  })

  it('draws fewer distinct geometries for a flat series than for a varied one', () => {
    // The positive form of the same claim: a series with three equal values has
    // less shape in it than a series with three different ones, and the drawing
    // reflects that rather than being the same picture with different labels.
    expect(distinct(render(chart(flat)).container)).toBeLessThan(
      distinct(render(chart(varied)).container)
    )
  })

  it('draws no column for a null rather than a zero-height one', () => {
    const withNull = [point(1, '1000.00'), point(2, null), point(3, '1000.00')]
    const complete = [point(1, '1000.00'), point(2, '900.00'), point(3, '1000.00')]
    expect(profile(render(chart(withNull)).container).length).toBeLessThan(
      profile(render(chart(complete)).container).length
    )
  })
})

/* -------------------------------------------------------------------------- */
/* StoreComparisonBars                                                         */
/* -------------------------------------------------------------------------- */

describe('the store comparison bars are a function of the store values', () => {
  const rows = (a: string, b: string, c: string) => [
    {
      key: 'GSA-001',
      storeShortName: 'Granite Chevrolet',
      storeType: 'Franchise',
      result: value(a),
      display: `$${a}`,
    },
    {
      key: 'GSA-002',
      storeShortName: 'Granite Subaru',
      storeType: 'Franchise',
      result: value(b),
      display: `$${b}`,
    },
    {
      key: 'GSA-003',
      storeShortName: 'Granite Pre-Owned',
      storeType: 'Independent',
      result: value(c),
      display: `$${c}`,
    },
  ]

  const bars = (a: string, b: string, c: string) => (
    <StoreComparisonBars title="Total gross" kpiId="KPI-GRS-001" rows={rows(a, b, c)} />
  )

  it('changes every bar when the stores change', () => {
    expect(profile(render(bars('3000.00', '500.00', '1500.00')).container)).not.toEqual(
      profile(render(bars('1000.00', '2000.00', '3000.00')).container)
    )
  })

  it('draws one width when all three stores are equal', () => {
    expect(distinct(render(bars('2000.00', '2000.00', '2000.00')).container)).toBe(1)
  })

  it('draws three widths when all three stores differ', () => {
    expect(distinct(render(bars('1000.00', '2000.00', '3000.00')).container)).toBe(3)
  })
})

/* -------------------------------------------------------------------------- */
/* DistributionStrip                                                           */
/* -------------------------------------------------------------------------- */

describe('the distribution strip is a function of its buckets', () => {
  const strip = (a: number, b: number, c: number) => (
    <DistributionStrip
      title="Front gross distribution"
      unit="deals"
      buckets={[
        { key: 'low', label: 'Under $1,000', count: a },
        { key: 'mid', label: '$1,000 to $2,000', count: b },
        { key: 'high', label: 'Over $2,000', count: c },
      ]}
      median={{ label: 'Median', display: '$1,500' }}
      mean={{ label: 'Mean', display: '$1,600' }}
    />
  )

  it('redistributes when the counts move', () => {
    expect(profile(render(strip(30, 5, 1)).container)).not.toEqual(
      profile(render(strip(10, 20, 30)).container)
    )
  })

  it('draws one width when the distribution is uniform', () => {
    expect(distinct(render(strip(12, 12, 12)).container)).toBe(1)
  })
})

/* -------------------------------------------------------------------------- */
/* ExecutiveMicroTrend                                                         */
/* -------------------------------------------------------------------------- */

describe('the executive microtrend is a function of its trailing months', () => {
  const trend = (amounts: readonly string[]) => (
    <ExecutiveMicroTrend
      measure="retail units"
      points={amounts.map((amount, index) =>
        microPoint(index + 1, amount, index === amounts.length - 1)
      )}
    />
  )

  it('moves when the trailing shape reverses', () => {
    expect(profile(render(trend(['40', '30', '20', '10'])).container)).not.toEqual(
      profile(render(trend(['10', '20', '30', '40'])).container)
    )
  })
})

/* -------------------------------------------------------------------------- */
/* InventoryAgeStack                                                           */
/* -------------------------------------------------------------------------- */

describe('the inventory age stack is a function of its buckets', () => {
  const stack = (a: number, b: number, c: number) => {
    const total = a + b + c
    return (
      <InventoryAgeStack
        title="Age distribution"
        segments={[
          { key: '0-30', label: '0 to 30 days', display: String(a), share: a / total },
          { key: '31-60', label: '31 to 60 days', display: String(b), share: b / total },
          { key: '61-90', label: '61 to 90 days', display: String(c), share: c / total },
        ]}
        snapshotNote="Positions at the snapshot date."
        thresholdDays={60}
      />
    )
  }

  it('changes the segment shares when the lot ages', () => {
    expect(profile(render(stack(10, 30, 60)).container)).not.toEqual(
      profile(render(stack(80, 15, 5)).container)
    )
  })

  it('draws fewer distinct shares when the buckets are even than when they are not', () => {
    // Not "exactly one": the stack renders a horizontal band and a vertical
    // fallback for narrow widths, and it also draws the aged-threshold marker,
    // whose offset is a function of the segments rather than of one segment. Two
    // geometries for an even lot and more for an uneven one is the property that
    // matters; pinning the exact count would pin the responsive strategy.
    expect(distinct(render(stack(10, 10, 10)).container)).toBeLessThan(
      distinct(render(stack(80, 15, 5)).container)
    )
  })
})

/* -------------------------------------------------------------------------- */
/* BridgeChart                                                                 */
/* -------------------------------------------------------------------------- */

describe('the gross bridge is a function of its steps', () => {
  const bridge = (volume: string, pvr: string) => (
    <BridgeChart
      title="What changed"
      bars={[
        bridgeBar('open', 'November', '100000.00', 'anchor'),
        bridgeBar('volume', 'Volume', volume, 'step'),
        bridgeBar('pvr', 'Front PVR', pvr, 'step'),
        bridgeBar('close', 'December', '120000.00', 'anchor'),
      ]}
      summary="November to December, decomposed into volume and front PVR."
    />
  )

  it('changes the step geometry when the decomposition changes', () => {
    expect(profile(render(bridge('2000.00', '18000.00')).container)).not.toEqual(
      profile(render(bridge('15000.00', '5000.00')).container)
    )
  })
})
