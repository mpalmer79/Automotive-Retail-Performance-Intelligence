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
