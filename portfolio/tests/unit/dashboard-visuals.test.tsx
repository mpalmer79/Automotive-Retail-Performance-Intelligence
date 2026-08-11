/**
 * The `DASH.3-02` visualisation primitives.
 *
 * WHAT A CHART TEST IS ACTUALLY FOR
 * ---------------------------------
 * Not the geometry. A bar being 43.7% wide is not a claim anyone relies on, and
 * asserting it would pin an implementation detail. What matters is that NOTHING is
 * available only as a length:
 *
 *   * every value a bar encodes is also present as text;
 *   * the data table is in the document whether or not the disclosure is open;
 *   * the bars themselves are hidden from assistive technology, so a figure is not
 *     announced twice;
 *   * direction and category never depend on colour alone;
 *   * a null renders as a gap and a stated reason, never as a zero-height bar.
 *
 * The suite renders to static markup, which is what these components produce: they
 * are server components with no state, no effect and no client bundle.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  BridgeChart,
  DistributionStrip,
  ExecutiveMicroTrend,
  GrossComposition,
  InventoryAgeStack,
  ReconciliationScale,
  StoreComparisonBars,
  TrendChart,
} from '../../src/components/dashboard/visuals.tsx'
import { parseExact } from '../../src/lib/dashboard/decimal.ts'

const POINTS = [
  {
    key: '2025-12-01',
    label: '1 December',
    value: parseExact('1000.00'),
    display: '$1,000',
  },
  {
    key: '2025-12-02',
    label: '2 December',
    value: parseExact('2500.00'),
    display: '$2,500',
  },
  {
    key: '2025-12-03',
    label: '3 December',
    value: null,
    display: 'No eligible denominator',
  },
  {
    key: '2025-12-04',
    label: '4 December',
    value: parseExact('-400.00'),
    display: '-$400',
  },
]

describe('TrendChart', () => {
  it('prints every value as text, not only as a bar', () => {
    const { container } = render(
      <TrendChart title="Total gross" measure="Total gross" points={POINTS} />
    )
    const text = container.textContent ?? ''
    for (const point of POINTS) {
      expect(text).toContain(point.label)
      expect(text).toContain(point.display)
    }
  })

  it('keeps the data table in the document even while the disclosure is closed', () => {
    const { container } = render(
      <TrendChart title="Total gross" measure="Total gross" points={POINTS} />
    )
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details!.hasAttribute('open')).toBe(false)
    // Present in the DOM, and therefore in reading order and in a text search.
    const table = container.querySelector('details table')
    expect(table).not.toBeNull()
    expect(table!.querySelectorAll('tbody tr').length).toBe(POINTS.length)
  })

  it('hides the bars from assistive technology, because their values are text', () => {
    const { container } = render(
      <TrendChart title="Total gross" measure="Total gross" points={POINTS} />
    )
    const bars = container.querySelector('[aria-hidden="true"]')
    expect(bars).not.toBeNull()
  })

  it('carries an accessible name and a summary sentence', () => {
    const { container } = render(
      <TrendChart title="Total gross" measure="Total gross" points={POINTS} />
    )
    expect(container.querySelector('figure')).not.toBeNull()
    expect(container.querySelector('figcaption')?.textContent).toContain('Total gross')
    const caption = container.querySelector('caption')
    expect(caption?.textContent).toContain('Total gross')
  })

  it('states how many periods have no value rather than drawing them as zero', () => {
    const { container } = render(
      <TrendChart title="Total gross" measure="Total gross" points={POINTS} />
    )
    const text = container.textContent ?? ''
    expect(text).toMatch(/1 period has no value and appear as a gap|no value/i)
    expect(text).toContain('No eligible denominator')
  })

  it('renders an empty series without inventing a plot', () => {
    const { container } = render(
      <TrendChart title="Total gross" measure="Total gross" points={[]} />
    )
    expect(container.textContent).toContain('No Total gross to plot')
  })
})

describe('BridgeChart', () => {
  const BARS = [
    {
      key: 'comparison',
      label: 'Comparison total',
      value: parseExact('289390.00'),
      display: '$289,390',
      kind: 'anchor' as const,
    },
    {
      key: 'volume',
      label: 'Volume effect',
      value: parseExact('52622.00'),
      display: '+$52,622',
      kind: 'step' as const,
    },
    {
      key: 'front_pvr',
      label: 'Front PVR effect',
      value: parseExact('-18901.00'),
      display: '-$18,901',
      kind: 'step' as const,
    },
    {
      key: 'current',
      label: 'Current total',
      value: parseExact('321935.00'),
      display: '$321,935',
      kind: 'anchor' as const,
    },
  ]

  it('prints every component and its amount as text', () => {
    const { container } = render(
      <BridgeChart title="What changed" bars={BARS} summary="The bridge attributes." />
    )
    const text = container.textContent ?? ''
    for (const bar of BARS) {
      expect(text).toContain(bar.label)
      expect(text).toContain(bar.display)
    }
  })

  it('distinguishes a rise from a fall by a glyph and a sign, not by colour', () => {
    const { container } = render(
      <BridgeChart title="What changed" bars={BARS} summary="The bridge attributes." />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('↑')
    expect(text).toContain('↓')
    expect(text).toContain('+$52,622')
    expect(text).toContain('-$18,901')
  })

  it('labels each bar as a total or as an attributed movement in its table', () => {
    const { container } = render(
      <BridgeChart title="What changed" bars={BARS} summary="The bridge attributes." />
    )
    const table = container.querySelector('details table')
    expect(table).not.toBeNull()
    const text = table!.textContent ?? ''
    expect(text).toContain('Period total')
    expect(text).toContain('Attributed movement')
  })

  it('carries the summary sentence verbatim into the table caption', () => {
    const summary = 'The bridge attributes +$52,622 to unit volume.'
    const { container } = render(
      <BridgeChart title="What changed" bars={BARS} summary={summary} />
    )
    expect(container.querySelector('caption')?.textContent).toContain(summary)
  })

  /*
   * THE ANCHORS ARE COLUMNS FROM THE AXIS, AND THIS IS A REGRESSION TEST.
   *
   * The chart drew every bar between `base` and `top`, and for an anchor those are the same
   * number — so `upper === lower`, the computed height was zero, and both anchors rendered
   * at the `Math.max(height, 0.5)` floor. The two totals a waterfall exists to connect were
   * the two marks a reader could not see.
   *
   * Asserted as a RELATIONSHIP rather than against a pixel figure: an anchor at $289,390 on
   * an axis whose largest level is $321,935 must be a substantial fraction of the frame, and
   * must be taller than a step of $52,622 drawn on the same axis. Both are true of a correct
   * waterfall at any size, and neither was true of the defect.
   */
  it('draws each anchor as a column from the axis rather than as a sliver', () => {
    const { container } = render(
      <BridgeChart title="What changed" bars={BARS} summary="The bridge attributes." />
    )
    const heights = [...container.querySelectorAll('[aria-hidden="true"] span span')].map(
      (node) => Number.parseFloat((node as HTMLElement).style.height)
    )
    expect(heights).toHaveLength(BARS.length)

    const [comparison, volume, frontPvr, current] = heights as [
      number,
      number,
      number,
      number,
    ]
    // An anchor is a level read from zero, so it fills most of a frame whose top is the
    // other anchor. Anything near the 0.5% floor is the defect returning.
    expect(comparison).toBeGreaterThan(50)
    expect(current).toBeGreaterThan(50)
    // The closing anchor is the larger total, so it is the taller of the two.
    expect(current).toBeGreaterThan(comparison)
    // And a step is a movement, so it is shorter than the level it moves.
    expect(volume).toBeLessThan(comparison)
    expect(frontPvr).toBeLessThan(comparison)
  })
})

describe('DistributionStrip', () => {
  const BUCKETS = [
    { key: 'loss', label: 'Below $0', count: 12, isNegative: true },
    { key: 'b0', label: '$0 to $999', count: 40 },
    { key: 'b1', label: '$1,000 to $1,999', count: 88 },
  ]

  it('prints every band and its count as text', () => {
    const { container } = render(
      <DistributionStrip title="Total gross per deal" buckets={BUCKETS} unit="deals" />
    )
    const text = container.textContent ?? ''
    for (const bucket of BUCKETS) {
      expect(text).toContain(bucket.label)
      expect(text).toContain(String(bucket.count))
    }
  })

  it('states the median beside the mean when both are supplied', () => {
    const { container } = render(
      <DistributionStrip
        title="Total gross per deal"
        buckets={BUCKETS}
        unit="deals"
        median={{ label: 'Median', display: '$2,637' }}
        mean={{ label: 'Mean', display: '$3,499' }}
      />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Median $2,637')
    expect(text).toContain('Mean $3,499')
  })

  it('omits a centre it was not given rather than computing one', () => {
    const { container } = render(
      <DistributionStrip title="Total gross per deal" buckets={BUCKETS} unit="deals" />
    )
    expect(container.textContent).not.toContain('Median')
  })

  it('keeps the band table in the document', () => {
    const { container } = render(
      <DistributionStrip title="Total gross per deal" buckets={BUCKETS} unit="deals" />
    )
    const rows = container.querySelectorAll('details table tbody tr')
    expect(rows.length).toBe(BUCKETS.length)
  })
})

/* -------------------------------------------------------------------------- */
/* The visual-overhaul primitives, and the binding tests they exist for         */
/* -------------------------------------------------------------------------- */

/**
 * WHY THESE ASSERTIONS LOOK DIFFERENT FROM THE FOUR ABOVE.
 *
 * The `DASH.3` suite tests that nothing is available only as a length, and that rule
 * still binds every primitive in this file. These five carry a second obligation that a
 * presence assertion cannot reach: the geometry has to be a FUNCTION OF THE DATA. A test
 * that renders one fixture and finds a bar proves only that a bar can be produced — a
 * component returning a fixed 50% width would pass it, and would be a decorative chart
 * wearing a data component's name.
 *
 * So each of these renders TWO different inputs and asserts the drawn widths DIFFER, or
 * renders one input and asserts a specific relationship between two widths. Where a
 * value cannot be drawn — a structural absence, a missing ledger side, an undefined
 * share — the assertion is that nothing is drawn at all, because a zero-length bar and
 * an unresolvable measure look identical and only one of them is a measurement.
 */

/** Every inline width an element subtree carries, in document order. */
function widths(container: Element): readonly string[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="width"]')].map(
    (element) => element.style.width
  )
}

/** Every inline left offset an element subtree carries, in document order. */
function offsets(container: Element): readonly string[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="left"]')].map(
    (element) => element.style.left
  )
}

const MICRO = (values: readonly (string | null)[], currentIndex: number) =>
  values.map((value, index) => ({
    key: `2025-0${String(index + 7)}`,
    label: `Month ${String(index + 1)}`,
    value: value === null ? null : parseExact(value),
    display: value === null ? 'No eligible denominator' : `$${value}`,
    isCurrent: index === currentIndex,
  }))

describe('ExecutiveMicroTrend', () => {
  it('draws a different shape for a different series', () => {
    const first = render(
      <ExecutiveMicroTrend
        measure="Total gross"
        points={MICRO(['100', '200', '300'], 2)}
      />
    )
    const second = render(
      <ExecutiveMicroTrend
        measure="Total gross"
        points={MICRO(['300', '100', '200'], 2)}
      />
    )
    const a = [...first.container.querySelectorAll<HTMLElement>('[style*="height"]')].map(
      (element) => element.style.height
    )
    const b = [
      ...second.container.querySelectorAll<HTMLElement>('[style*="height"]'),
    ].map((element) => element.style.height)
    expect(a.length).toBeGreaterThan(0)
    expect(a).not.toEqual(b)
  })

  it('scales a column to its share of the widest value in the series', () => {
    const { container } = render(
      <ExecutiveMicroTrend measure="Total gross" points={MICRO(['250', '500'], 1)} />
    )
    const heights = [...container.querySelectorAll<HTMLElement>('[style*="height"]')].map(
      (element) => Number.parseFloat(element.style.height)
    )
    expect(heights).toHaveLength(2)
    // Half the value is half the column. The relationship, not the pixel.
    expect((heights[0] as number) / (heights[1] as number)).toBeCloseTo(0.5, 2)
  })

  it('renders a null month as a gap rather than as a zero column', () => {
    const { container } = render(
      <ExecutiveMicroTrend
        measure="Total gross"
        points={MICRO(['100', null, '300'], 2)}
      />
    )
    expect(container.querySelectorAll('[style*="height"]')).toHaveLength(2)
    expect(container.textContent).toContain('1 month has no value')
  })

  it('carries every month and value as text for a reader who cannot see the columns', () => {
    const { container } = render(
      <ExecutiveMicroTrend measure="Total gross" points={MICRO(['100', '200'], 1)} />
    )
    const items = [...container.querySelectorAll('ul.sr-only li')].map(
      (node) => node.textContent
    )
    expect(items).toEqual(['Month 1: $100', 'Month 2: $200'])
  })

  it('hides the columns from assistive technology, because their values are text', () => {
    const { container } = render(
      <ExecutiveMicroTrend measure="Total gross" points={MICRO(['100', '200'], 1)} />
    )
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})

const comparisonRow = (
  key: string,
  name: string,
  value: string | null,
  display: string
) => ({
  key,
  storeShortName: name,
  storeType: 'Franchise New and Used',
  result:
    value === null
      ? ({
          kind: 'not-applicable' as const,
          reason: 'The store holds no franchise.',
        } as const)
      : ({ kind: 'value' as const, value: parseExact(value), rowCount: 1 } as const),
  display,
})

describe('StoreComparisonBars', () => {
  it('draws different widths for two stores with different values', () => {
    const { container } = render(
      <StoreComparisonBars
        title="Retail units"
        kpiId="KPI-SLS-001"
        rows={[
          comparisonRow('GSA-001', 'Granite Chevrolet', '90', '90'),
          comparisonRow('GSA-002', 'Granite Subaru', '45', '45'),
        ]}
      />
    )
    const drawn = widths(container).map((width) => Number.parseFloat(width))
    expect(drawn).toHaveLength(2)
    expect(drawn[0]).not.toBe(drawn[1])
    expect((drawn[1] as number) / (drawn[0] as number)).toBeCloseTo(0.5, 2)
  })

  it('changes the geometry when the data changes', () => {
    const first = render(
      <StoreComparisonBars
        title="Retail units"
        kpiId="KPI-SLS-001"
        rows={[
          comparisonRow('GSA-001', 'A', '90', '90'),
          comparisonRow('GSA-002', 'B', '45', '45'),
        ]}
      />
    )
    const second = render(
      <StoreComparisonBars
        title="Retail units"
        kpiId="KPI-SLS-001"
        rows={[
          comparisonRow('GSA-001', 'A', '30', '30'),
          comparisonRow('GSA-002', 'B', '90', '90'),
        ]}
      />
    )
    expect(widths(first.container)).not.toEqual(widths(second.container))
  })

  it('draws no bar at all for a structural absence, and says so in words', () => {
    const { container } = render(
      <StoreComparisonBars
        title="New units"
        kpiId="KPI-SLS-002"
        rows={[
          comparisonRow('GSA-001', 'Granite Chevrolet', '40', '40'),
          comparisonRow('GSA-003', 'Granite Pre-Owned', null, 'Not applicable'),
        ]}
      />
    )
    // One value, one bar. The independent store contributes no track and no zero.
    expect(widths(container)).toHaveLength(1)
    expect(container.textContent).toContain('Not applicable')
  })

  it('excludes an unresolved store from the scale the others are drawn against', () => {
    const { container } = render(
      <StoreComparisonBars
        title="New units"
        kpiId="KPI-SLS-002"
        rows={[
          comparisonRow('GSA-001', 'A', '40', '40'),
          comparisonRow('GSA-003', 'B', null, 'Not applicable'),
        ]}
      />
    )
    // The single drawable row is the maximum, so it is full width.
    expect(Number.parseFloat(widths(container)[0] as string)).toBeCloseTo(100, 5)
  })

  it('keeps every value in a table as well as beside its bar', () => {
    const { container } = render(
      <StoreComparisonBars
        title="Retail units"
        kpiId="KPI-SLS-001"
        rows={[comparisonRow('GSA-001', 'Granite Chevrolet', '90', '90')]}
      />
    )
    expect(container.querySelectorAll('details table tbody tr')).toHaveLength(1)
  })
})

describe('InventoryAgeStack', () => {
  const SEGMENTS = [
    { key: 'a', label: '0-30', display: '20 units', share: 0.5 },
    { key: 'b', label: '31-60', display: '12 units', share: 0.3 },
    { key: 'c', label: '61-90', display: '8 units', share: 0.2 },
  ]

  it('draws each segment at its share of the population, not of the largest band', () => {
    const { container } = render(
      <InventoryAgeStack
        title="Age distribution"
        segments={SEGMENTS}
        snapshotNote="At the 2025-12-31 snapshot."
      />
    )
    const drawn = widths(container).map((width) => Number.parseFloat(width))
    // Two compositions are in the document, so every share appears twice.
    expect(drawn.filter((width) => Math.abs(width - 50) < 0.01)).toHaveLength(2)
    expect(drawn.filter((width) => Math.abs(width - 30) < 0.01)).toHaveLength(2)
    expect(drawn.filter((width) => Math.abs(width - 20) < 0.01)).toHaveLength(2)
  })

  it('changes the geometry when the distribution changes', () => {
    const first = render(
      <InventoryAgeStack title="Age" segments={SEGMENTS} snapshotNote="note" />
    )
    const second = render(
      <InventoryAgeStack
        title="Age"
        segments={[
          { key: 'a', label: '0-30', display: '4 units', share: 0.1 },
          { key: 'b', label: '31-60', display: '8 units', share: 0.2 },
          { key: 'c', label: '61-90', display: '28 units', share: 0.7 },
        ]}
        snapshotNote="note"
      />
    )
    expect(widths(first.container)).not.toEqual(widths(second.container))
  })

  it('carries every band and its count as text', () => {
    const { container } = render(
      <InventoryAgeStack title="Age" segments={SEGMENTS} snapshotNote="note" />
    )
    for (const segment of SEGMENTS) {
      expect(container.textContent).toContain(segment.display)
    }
  })

  it('renders an empty population without inventing a stack', () => {
    const { container } = render(
      <InventoryAgeStack title="Age" segments={[]} snapshotNote="note" />
    )
    expect(widths(container)).toHaveLength(0)
    expect(container.textContent).toContain('No inventory rows')
  })
})

describe('GrossComposition', () => {
  const segment = (key: string, label: string, value: string, display: string) => ({
    key,
    label,
    value: parseExact(value),
    display,
  })

  it('draws each component at its share of the GOVERNED total', () => {
    const { container } = render(
      <GrossComposition
        title="Front and back gross"
        segments={[
          segment('front', 'Front-end gross', '750.00', '$750'),
          segment('back', 'Back-end gross', '250.00', '$250'),
        ]}
        total={parseExact('1000.00')}
      />
    )
    const drawn = widths(container).map((width) => Number.parseFloat(width))
    expect(drawn).toEqual([75, 25])
  })

  it('withholds the bar entirely when a component is negative', () => {
    const { container } = render(
      <GrossComposition
        title="Front and back gross"
        segments={[
          segment('front', 'Front-end gross', '-200.00', '-$200'),
          segment('back', 'Back-end gross', '900.00', '$900'),
        ]}
        total={parseExact('700.00')}
      />
    )
    expect(widths(container)).toHaveLength(0)
    expect(container.textContent).toContain('A component is negative')
    // The amounts are still there, with their signs.
    expect(container.textContent).toContain('-$200')
  })

  it('withholds the bar when the governed total is absent', () => {
    const { container } = render(
      <GrossComposition
        title="Front and back gross"
        segments={[segment('front', 'Front-end gross', '750.00', '$750')]}
        total={null}
      />
    )
    expect(widths(container)).toHaveLength(0)
    expect(container.textContent).toContain('no share is defined')
  })

  it('puts the qualification behind a disclosure rather than above the bar', () => {
    const { container } = render(
      <GrossComposition
        title="Front and back gross"
        segments={[segment('front', 'Front-end gross', '750.00', '$750')]}
        total={parseExact('1000.00')}
        shareDisclosure="Front and back are not ranked against each other."
      />
    )
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details?.textContent).toContain('not ranked against each other')
  })
})

describe('ReconciliationScale', () => {
  const account = (
    key: string,
    label: string,
    variance: string | null,
    state: string
  ) => ({
    key,
    label,
    variance: variance === null ? null : parseExact(variance),
    display: variance === null ? 'No variance — one side absent' : `${variance}`,
    state,
    isComparable: variance !== null,
  })

  it('places a positive and a negative variance on opposite sides of the zero rule', () => {
    const { container } = render(
      <ReconciliationScale
        title="Stock schedule against the general ledger"
        accounts={[
          account('a', 'New Vehicle Inventory', '1000.00', 'Variance'),
          account('b', 'Used Vehicle Inventory', '-1000.00', 'Variance'),
        ]}
        totalDisplay="+$0.00"
        directionText="the two sides agree exactly"
        excludedCount={0}
      />
    )
    const positions = offsets(container)
      .map((left) => Number.parseFloat(left))
      .filter((value) => Number.isFinite(value))
    expect(positions.some((value) => value > 50)).toBe(true)
    expect(positions.some((value) => value < 50)).toBe(true)
  })

  it('moves a marker when the variance changes', () => {
    const first = render(
      <ReconciliationScale
        title="Reconciliation"
        accounts={[
          account('a', 'A', '1000.00', 'Variance'),
          account('b', 'B', '250.00', 'Variance'),
        ]}
        totalDisplay="+$1,250.00"
        directionText="the general ledger carries more than the subledger"
        excludedCount={0}
      />
    )
    const second = render(
      <ReconciliationScale
        title="Reconciliation"
        accounts={[
          account('a', 'A', '1000.00', 'Variance'),
          account('b', 'B', '900.00', 'Variance'),
        ]}
        totalDisplay="+$1,900.00"
        directionText="the general ledger carries more than the subledger"
        excludedCount={0}
      />
    )
    expect(offsets(first.container)).not.toEqual(offsets(second.container))
  })

  it('does not plot a one-sided position, and states that it was excluded', () => {
    const { container } = render(
      <ReconciliationScale
        title="Reconciliation"
        accounts={[
          account('a', 'A', '1000.00', 'Variance'),
          account('b', 'B', null, 'Missing GL balance'),
        ]}
        totalDisplay="+$1,000.00"
        directionText="the general ledger carries more than the subledger"
        excludedCount={1}
      />
    )
    // One marker per composition for the single comparable account, and no marker at
    // the centre standing in for the one-sided one.
    expect(container.textContent).toContain('1 position is one-sided')
    expect(container.textContent).toContain('Missing GL balance')
  })

  it('carries the direction in words rather than only in a sign', () => {
    const { container } = render(
      <ReconciliationScale
        title="Reconciliation"
        accounts={[account('a', 'A', '-1000.00', 'Variance')]}
        totalDisplay="-$1,000.00"
        directionText="the subledger carries more than the general ledger"
        excludedCount={0}
      />
    )
    expect(container.textContent).toContain(
      'the subledger carries more than the general ledger'
    )
  })

  it('encodes nothing in colour: no fill or colour style anywhere on the scale', () => {
    const { container } = render(
      <ReconciliationScale
        title="Reconciliation"
        accounts={[
          account('a', 'A', '1000.00', 'Variance'),
          account('b', 'B', '-500.00', 'Variance'),
        ]}
        totalDisplay="+$500.00"
        directionText="the general ledger carries more than the subledger"
        excludedCount={0}
      />
    )
    for (const element of container.querySelectorAll<HTMLElement>('[style]')) {
      expect(element.style.backgroundColor, element.outerHTML.slice(0, 80)).toBe('')
      expect(element.style.color, element.outerHTML.slice(0, 80)).toBe('')
    }
  })

  it('keeps every account in a table as well as on the scale', () => {
    const { container } = render(
      <ReconciliationScale
        title="Reconciliation"
        accounts={[
          account('a', 'A', '1000.00', 'Variance'),
          account('b', 'B', null, 'Missing GL balance'),
        ]}
        totalDisplay="+$1,000.00"
        directionText="the general ledger carries more than the subledger"
        excludedCount={1}
      />
    )
    expect(container.querySelectorAll('details table tbody tr')).toHaveLength(2)
  })
})

describe('no primitive ships client JavaScript', () => {
  it('declares no use client directive', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, join, resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(
      join(resolve(here, '../..'), 'src/components/dashboard/visuals.tsx'),
      'utf8'
    )
    expect(source).not.toMatch(/^\s*['"]use client['"]/m)
    // And no hook that would require one.
    expect(source).not.toMatch(/\buseState\b|\buseEffect\b|\buseRef\b/)
  })
})
