/**
 * `UX.2B.1`: the presentation defects a parallel `UX.2B` implementation found, fixed on
 * the canonical one.
 *
 * WHY THESE TESTS EXIST AT ALL. A second, independent implementation of `UX.2B` (PR #62)
 * was built from the same base as the one that merged. It is not merged and will not be —
 * but reading it against canonical `main` surfaced four defects in SHARED PRIMITIVES that
 * the merged implementation carried unchanged from before `UX.2B`. Each test below pins
 * one of them, so the fix cannot silently regress the next time the primitive is touched.
 *
 * THE ASSERTIONS ARE GEOMETRIC, NOT COSMETIC. Every one names the property that made the
 * defect a defect — an anchor that cannot be seen, a chart with no horizontal reference, a
 * scroll region a keyboard cannot reach — rather than a class name that happens to encode
 * the current fix. A different correct fix should keep these green.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { GridRow, Module } from '../../src/components/dashboard/workspace-grid.tsx'
import {
  BridgeChart,
  TableDisclosure,
  TrendChart,
  type BridgeBar,
  type TrendPoint,
} from '../../src/components/dashboard/visuals.tsx'
import { parseExact } from '../../src/lib/dashboard/decimal.ts'

afterEach(cleanup)

/* An opening total, three movements and a closing total: the shape a waterfall is for. */
const BARS: readonly BridgeBar[] = [
  {
    key: 'open',
    label: 'Comparison total',
    value: parseExact('289390'),
    display: '$289,390',
    kind: 'anchor',
  },
  {
    key: 'volume',
    label: 'Volume effect',
    value: parseExact('52622'),
    display: '+$52,622',
    kind: 'step',
  },
  {
    key: 'front',
    label: 'Front PVR effect',
    value: parseExact('-18901'),
    display: '-$18,901',
    kind: 'step',
  },
  {
    key: 'close',
    label: 'Current total',
    value: parseExact('321935'),
    display: '$321,935',
    kind: 'anchor',
  },
]

/** The rendered height of a mark, as a number of percent. */
function heights(container: HTMLElement): readonly number[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[style*="height"]')).map(
    (mark) => Number.parseFloat(mark.style.height)
  )
}

/*
 * THE ANCHOR FIX ITSELF IS TESTED IN `dashboard-visuals.test.tsx`, NOT HERE.
 *
 * It reached `main` independently through #63, which was opened from the parallel
 * branch and merged while this refinement was in review, and it brought its own
 * assertions: each anchor above the 0.5% floor, the closing anchor taller than the
 * opening one, and both steps shorter than either. Restating those here would be two
 * suites pinning one property, so what remains below is only what that suite does not
 * cover — the INVERSION, which is the property a chart ignoring its input would fail,
 * and the label, which is a different defect.
 */
describe('the waterfall follows its data and names its bars', () => {
  it('inverts the anchor relationship when the closing total is the lower one', () => {
    /* The seeded defect: a chart that ignored its input would keep the same picture. */
    const falling = BARS.map((bar) =>
      bar.key === 'close'
        ? { ...bar, value: parseExact('210000'), display: '$210,000' }
        : bar
    )
    const { container } = render(
      <BridgeChart
        title="What changed"
        bars={falling}
        summary="Attribution, not cause."
      />
    )
    const drawn = heights(container).filter((height) => Number.isFinite(height))
    const opening = drawn[0]
    const closing = drawn[drawn.length - 1]
    expect(closing as number).toBeLessThan(opening as number)
  })

  it('names the closing anchor in full rather than truncating it', () => {
    /* `truncate` rendered "Front-end ..." in a five-of-twelve module — a label that
       names nothing. The label must survive as text whatever the column width. */
    render(<BridgeChart title="What changed" bars={BARS} summary="Attribution." />)
    expect(screen.getAllByText('Current total').length).toBeGreaterThan(0)
  })
})

describe('the trend states the span it covers', () => {
  const POINTS: readonly TrendPoint[] = [
    { key: 'a', label: 'Nov 3', value: parseExact('10'), display: '10' },
    { key: 'b', label: 'Nov 10', value: parseExact('14'), display: '14' },
    { key: 'c', label: 'Dec 29', value: parseExact('12'), display: '12' },
  ]

  it('draws the first and last period labels under the columns', () => {
    /*
     * THE DEFECT. The chart drew a bare column field with no horizontal reference: a
     * reader could see the shape and could not tell whether it covered a fortnight or six
     * months without opening the table. `ExecutiveMicroTrend` has drawn its ends since
     * `UX.2A`; this is the same console answering the same question the same way.
     */
    const { container } = render(
      <TrendChart title="Retail units" measure="retail units" points={POINTS} />
    )
    const axis = container.querySelector('[aria-hidden="true"].flex.justify-between')
    expect(axis).not.toBeNull()
    expect(axis?.textContent).toContain('Nov 3')
    expect(axis?.textContent).toContain('Dec 29')
  })

  it('follows the data rather than printing fixed ends', () => {
    const shifted = POINTS.map((point, index) =>
      index === 0 ? { ...point, label: 'Jan 6' } : point
    )
    const { container } = render(
      <TrendChart title="Retail units" measure="retail units" points={shifted} />
    )
    const axis = container.querySelector('[aria-hidden="true"].flex.justify-between')
    expect(axis?.textContent).toContain('Jan 6')
    expect(axis?.textContent).not.toContain('Nov 3')
  })

  it('carries the labels for sighted readers only, because the table has every period', () => {
    /* Two of twenty-six periods repeated into the accessibility tree is noise: the
       `sr-only` summary and the table already carry all of them. */
    const { container } = render(
      <TrendChart title="Retail units" measure="retail units" points={POINTS} />
    )
    const axis = container.querySelector('.flex.justify-between')
    expect(axis?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('a scrolling disclosure is reachable without a pointer', () => {
  it('makes the scroll container a focusable, named region', () => {
    /*
     * WCAG 2.1.1. A region that scrolls horizontally must be reachable by keyboard, or a
     * reader without a pointer cannot see its right-hand columns at all. The route-level
     * tables on this console have carried this since `DASH.9`; the primitive did not, so
     * the inventory unit table would have lost it on being moved inside.
     */
    const { container } = render(
      <TableDisclosure title="all 250 units">
        <table>
          <tbody>
            <tr>
              <td>row</td>
            </tr>
          </tbody>
        </table>
      </TableDisclosure>
    )
    const region = container.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('tabindex')).toBe('0')
    /* Named, because a stop announced only as "region" does not say which table it is. */
    expect(region?.getAttribute('aria-label')).toBe('all 250 units')
    expect(region?.className).toContain('overflow-x-auto')
  })
})

describe('a module is the layout reference for its own contents', () => {
  it('establishes a container so its grids can ask the panel width', () => {
    /*
     * THE DEFECT. The section components were written when each was a full-width band, so
     * their fact grids asked for four columns at the `lg` VIEWPORT width — and a three-of-
     * twelve module on a 1440 px screen is about 300 px wide while still satisfying `lg`.
     * On the Deal Jacket that broke a money value across lines: `AMOUNT FINANCED`
     * rendered as "$21,358." above "02".
     */
    const { container } = render(
      <Module id="finance" title="Deal structure" span={3}>
        <p>content</p>
      </Module>
    )
    const panel = container.querySelector('section')
    expect(panel?.className).toContain('@container')
  })

  it('lets a row size its modules to content instead of stretching them', () => {
    /* A 350 px waterfall stretched beside a 750 px sibling drew 400 px of empty bordered
       box, and an empty panel is not neutral — a reader looks into it for what is
       missing. The row must be able to say the modules are different sizes. */
    const { container } = render(
      <GridRow align="start">
        <Module id="a" title="A" span={5}>
          <p>a</p>
        </Module>
      </GridRow>
    )
    expect(container.firstElementChild?.className).toContain('items-start')
  })
})

describe('the unit population survives being disclosed', () => {
  it('keeps every row in the document behind a summary that states the count', () => {
    /*
     * The inventory unit table was 9,550 px of an 11,828 px route. Collapsing it must not
     * remove it: the rows stay in the markup, the print rule opens every disclosure on
     * paper, and the summary states how many are behind it so a reader knows before
     * opening. This asserts exactly that, on the primitive the route now uses.
     */
    const { container } = render(
      <TableDisclosure title="all 3 units at 31 December 2025">
        <table>
          <tbody>
            <tr>
              <td>one</td>
            </tr>
            <tr>
              <td>two</td>
            </tr>
            <tr>
              <td>three</td>
            </tr>
          </tbody>
        </table>
      </TableDisclosure>
    )
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    /* Collapsed by default -- the point of the change. */
    expect((details as HTMLDetailsElement).open).toBe(false)
    /* And every row is still there to be found, printed or read by markup. */
    expect(
      within(details as HTMLElement).getAllByRole('row', { hidden: true })
    ).toHaveLength(3)
    expect(details?.querySelector('summary')?.textContent).toContain('3 units')
  })
})
