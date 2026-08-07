/**
 * The console's visualisation primitives.
 *
 * THE EVALUATION THAT PRODUCED THESE (`DASH.3-02`)
 * ------------------------------------------------
 * The increment required the chart decision to be made from evidence rather than
 * habit. Two options were compared.
 *
 * Option A, a charting library (Recharts, Visx, Chart.js and the like). Rejected on
 * four measurements and one principle:
 *
 *   * BUNDLE. The whole console ships about 1.6 kB of route-owned client JavaScript
 *     today, because one component is a client island. The smallest of these
 *     libraries is two orders of magnitude larger than that before a single chart is
 *     drawn, and it is the kind of cost that never comes back off.
 *   * SERVER RENDERING. Every one of them needs a measured container to lay out, so
 *     the useful configurations are client components. The console's guarantee is
 *     that every figure is in the HTML; a chart that paints after hydration breaks it
 *     for the no-JavaScript reader the e2e suite tests.
 *   * ACCESSIBILITY. They render to canvas, or to SVG whose values live in `<path>`
 *     coordinates. Either way the numbers leave the DOM, where a screen reader and a
 *     browser text search can currently both find them.
 *   * MAINTENANCE. A chart library is a second design system: its own spacing, its own
 *     type scale, its own colour API. Reconciling it with the tokens costs more than
 *     the drawing does.
 *
 * Option B, extending the hand-built primitives. Chosen. `BarChart` and
 * `StackedMixBar` in `components/visuals/inventory-charts.tsx` already prove the
 * shape works: a `<figure>`, bars that are `aria-hidden` decoration, and a real
 * `<table>` carrying every value. These three add the forms that file does not have.
 * Measured bundle delta: **zero bytes of client JavaScript**. They are server
 * components and ship no script at all.
 *
 * WHAT IS HERE, AND WHAT IS DELIBERATELY NOT
 * ------------------------------------------
 * Three primitives, because the Sales and Gross page uses three:
 *
 *   `TrendChart`         a value over time
 *   `BridgeChart`        a waterfall, for the gross-change decomposition
 *   `DistributionStrip`  a bucketed distribution, for deal-level gross
 *
 * The backlog also reserved pace/bullet and funnel primitives. Neither is built:
 * `DASH.5` owns targets and therefore owns the only thing a bullet bar would encode,
 * and the Executive Overview's funnel is already rendered by its own component. An
 * abstraction built for a page that does not exist is a guess about that page.
 *
 * EXACT VALUES IN, APPROXIMATE NUMBERS ONLY FOR GEOMETRY
 * ------------------------------------------------------
 * Every value arrives as an `Exact` and is formatted for display by the governed
 * formatters. `exactToApproxNumber` is called ONLY to compute a width or a coordinate
 * -- a bar is drawn to the nearest pixel, so a float is harmless there and nowhere
 * else. No displayed figure is ever derived from one.
 */
import type { ReactNode } from 'react'

import type { Exact } from '@/lib/dashboard/decimal'
import {
  compareExact,
  exactToApproxNumber,
  exactZero,
  isNegative,
} from '@/lib/dashboard/decimal'
import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

/** Turn a title into a stable id fragment, so a table can be labelled by it. */
function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The disclosure carrying a chart's data table.
 *
 * `<details>` keeps the table in the document -- and therefore in the accessibility
 * tree's reading order and in a browser text search -- while collapsing it visually.
 * The e2e suite reads it with `textContent` for exactly that reason.
 */
function TableDisclosure({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <details className="rounded-lg border border-line-subtle bg-surface-sunken/50">
      <summary className="flex min-h-touch cursor-pointer items-center px-3 text-xs font-medium text-ink-muted transition-colors duration-(--arpi-motion-fast) hover:text-accent">
        {`Read ${title.toLowerCase()} as a table`}
      </summary>
      <div className="overflow-x-auto px-3 pb-3">{children}</div>
    </details>
  )
}

/** The shared figure frame: heading, optional caption, then the visual. */
function ChartFrame({
  title,
  caption,
  summary,
  headingLevel = 3,
  className,
  children,
}: {
  readonly title: string
  readonly caption?: ReactNode
  /** One sentence stating what the visual shows. Read by everyone, not just AT. */
  readonly summary: string
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
  readonly children: ReactNode
}) {
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4'
  return (
    <figure className={cx('flex flex-col gap-4', className)}>
      <figcaption className="flex flex-col gap-1.5">
        <Heading className="text-base font-semibold text-ink">{title}</Heading>
        {caption ? <p className="text-sm leading-normal text-ink-muted">{caption}</p> : null}
        <p className="text-sm leading-normal text-ink-secondary">{summary}</p>
      </figcaption>
      {children}
    </figure>
  )
}

/* -------------------------------------------------------------------------- */
/* TrendChart                                                                  */
/* -------------------------------------------------------------------------- */

/** One point on a trend. */
export interface TrendPoint {
  readonly key: string
  /** The period label a reader reads, e.g. "3 Nov" or "November 2025". */
  readonly label: string
  /** The value. `null` renders a GAP, never a zero. */
  readonly value: Exact | null
  /** The value as the reader should see it, already formatted. */
  readonly display: string
}

export interface TrendChartProps {
  readonly title: string
  readonly caption?: ReactNode
  /** What the values are, e.g. "total gross". Used in the summary sentence. */
  readonly measure: string
  readonly points: readonly TrendPoint[]
  readonly periodHeading?: string
  readonly valueHeading?: string
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}

/**
 * A value over time, drawn as a column per period.
 *
 * COLUMNS RATHER THAN A LINE. A line implies the quantity existed between the
 * points, which is true of a temperature and false of a day's gross: there is no
 * gross "between" Tuesday and Wednesday. Columns say what the data says.
 *
 * A NULL IS A GAP, NOT A ZERO. A day with no retail units has an undefined per-unit
 * gross, and drawing it at the baseline would assert the store earned nothing per
 * unit that day. Those columns are omitted and the table prints the reason.
 *
 * THE BASELINE IS ALWAYS ZERO for a non-negative series, because a truncated
 * baseline misstates every ratio a reader takes off the picture. Where the series
 * contains negatives the axis runs from the minimum to the maximum and a zero rule
 * is drawn, so the sign is visible rather than implied.
 */
export function TrendChart({
  title,
  caption,
  measure,
  points,
  periodHeading = 'Period',
  valueHeading = 'Value',
  headingLevel = 3,
  className,
}: TrendChartProps) {
  const tableId = `trend-${slug(title)}`
  const present = points.filter((point) => point.value !== null)
  const numbers = present.map((point) => exactToApproxNumber(point.value as Exact))
  const maximum = numbers.length > 0 ? Math.max(...numbers, 0) : 0
  const minimum = numbers.length > 0 ? Math.min(...numbers, 0) : 0
  const span = maximum - minimum || 1
  const zeroOffset = ((0 - minimum) / span) * 100
  const missing = points.length - present.length

  const summary =
    present.length === 0
      ? `No ${measure} to plot for this period.`
      : `${measure} across ${String(points.length)} period${points.length === 1 ? '' : 's'}, ` +
        `from ${present[0]?.display ?? ''} to ${present[present.length - 1]?.display ?? ''}` +
        (missing > 0
          ? `. ${String(missing)} period${missing === 1 ? ' has' : 's have'} no value and ` +
            'appear as a gap.'
          : '.')

  return (
    <ChartFrame
      title={title}
      caption={caption}
      summary={summary}
      headingLevel={headingLevel}
      className={className}
    >
      {present.length > 0 ? (
        <div
          aria-hidden="true"
          className="relative flex h-32 items-end gap-px border-b border-line-subtle"
        >
          {minimum < 0 ? (
            <span
              className="absolute inset-x-0 border-t border-dashed border-line"
              style={{ bottom: `${String(zeroOffset)}%` }}
            />
          ) : null}
          {points.map((point) => {
            if (point.value === null) {
              return <span key={point.key} className="min-w-0 flex-1" />
            }
            const value = exactToApproxNumber(point.value)
            const height = (Math.abs(value) / span) * 100
            const negative = value < 0
            return (
              <span
                key={point.key}
                className="relative flex min-w-0 flex-1 items-end"
                style={{ height: '100%' }}
              >
                <span
                  className={cx(
                    'w-full rounded-t-xs',
                    negative ? 'bg-ink-faint' : 'bg-accent/70'
                  )}
                  style={{
                    height: `${String(Math.max(height, 0.5))}%`,
                    marginBottom: negative
                      ? `${String(Math.max(zeroOffset - height, 0))}%`
                      : `${String(zeroOffset)}%`,
                  }}
                />
              </span>
            )
          })}
        </div>
      ) : null}

      <TableDisclosure title={title}>
        <table id={tableId} className="w-full border-collapse text-sm">
          <caption className="sr-only">{`${title}. ${summary}`}</caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                {periodHeading}
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                {valueHeading}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.key} className="border-b border-line-subtle/60 last:border-0">
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {point.label}
                </th>
                <td className="numeric py-1.5 text-right text-ink">{point.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* BridgeChart                                                                 */
/* -------------------------------------------------------------------------- */

/** One bar of a waterfall. */
export interface BridgeBar {
  readonly key: string
  readonly label: string
  /** The amount. For an anchor this is the level; for a step it is the movement. */
  readonly value: Exact
  readonly display: string
  /**
   * `anchor` bars sit on the baseline and represent a total; `step` bars float and
   * represent a movement between the anchors.
   */
  readonly kind: 'anchor' | 'step'
  /** Rendered under the value. Used for the rounding note. */
  readonly note?: string
}

export interface BridgeChartProps {
  readonly title: string
  readonly caption?: ReactNode
  readonly bars: readonly BridgeBar[]
  /** The sentence stating what the decomposition attributes. Non-causal wording. */
  readonly summary: string
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}

/**
 * A waterfall: two anchors with the steps that connect them.
 *
 * THE PICTURE IS NOT THE ARITHMETIC. The bars are `aria-hidden`, every amount is
 * printed beside its label, and the table carries all of it. The identity this chart
 * illustrates is verified in the page, against the exported numerators, and its
 * result is rendered as words -- not inferred by a reader from bar lengths.
 *
 * DIRECTION IS NOT COLOUR ALONE. An increase and a decrease differ in their arrow
 * glyph and in their signed amount, both of which are text. The fill differs too, but
 * nothing is encoded only in it.
 */
export function BridgeChart({
  title,
  caption,
  bars,
  summary,
  headingLevel = 3,
  className,
}: BridgeChartProps) {
  const tableId = `bridge-${slug(title)}`

  // Running levels, so a step floats between the level before it and after it.
  const levels: number[] = []
  let running = 0
  for (const bar of bars) {
    if (bar.kind === 'anchor') {
      running = exactToApproxNumber(bar.value)
      levels.push(running)
    } else {
      levels.push(running)
      running += exactToApproxNumber(bar.value)
    }
  }
  const tops = bars.map((bar, index) => {
    const base = levels[index] ?? 0
    return bar.kind === 'anchor' ? base : base + exactToApproxNumber(bar.value)
  })
  const highest = Math.max(...tops, ...levels, 0)
  const lowest = Math.min(...tops, ...levels, 0)
  const span = highest - lowest || 1

  return (
    <ChartFrame
      title={title}
      caption={caption}
      summary={summary}
      headingLevel={headingLevel}
      className={className}
    >
      <div
        aria-hidden="true"
        className="flex h-40 items-end gap-2 border-b border-line-subtle"
      >
        {bars.map((bar, index) => {
          const base = levels[index] ?? 0
          const top = tops[index] ?? 0
          const upper = Math.max(base, top)
          const lower = Math.min(base, top)
          const height = ((upper - lower) / span) * 100
          const offset = ((lower - lowest) / span) * 100
          const falling = bar.kind === 'step' && isNegative(bar.value)
          return (
            <span key={bar.key} className="relative flex h-full min-w-0 flex-1 items-end">
              <span
                className={cx(
                  'w-full rounded-xs',
                  bar.kind === 'anchor'
                    ? 'bg-ink/70'
                    : falling
                      ? 'bg-ink-faint'
                      : 'bg-accent/70'
                )}
                style={{
                  height: `${String(Math.max(height, 0.5))}%`,
                  marginBottom: `${String(offset)}%`,
                }}
              />
            </span>
          )
        })}
      </div>

      {/* Labels and amounts, as text, in the same order as the bars. */}
      <ul className="flex gap-2">
        {bars.map((bar) => {
          const falling = bar.kind === 'step' && isNegative(bar.value)
          const rising = bar.kind === 'step' && !isNegative(bar.value)
          return (
            <li key={bar.key} className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-xs text-ink-muted">{bar.label}</span>
              <span className="numeric text-sm font-semibold text-ink">
                {rising ? <span aria-hidden="true">{'↑ '}</span> : null}
                {falling ? <span aria-hidden="true">{'↓ '}</span> : null}
                {bar.display}
              </span>
              {bar.note ? (
                <span className="text-xs text-ink-faint">{bar.note}</span>
              ) : null}
            </li>
          )
        })}
      </ul>

      <TableDisclosure title={title}>
        <table id={tableId} className="w-full border-collapse text-sm">
          <caption className="sr-only">{`${title}. ${summary}`}</caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Component
              </th>
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Role
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.key} className="border-b border-line-subtle/60 last:border-0">
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {bar.label}
                </th>
                <td className="py-1.5 pr-3 text-ink-muted">
                  {bar.kind === 'anchor' ? 'Period total' : 'Attributed movement'}
                </td>
                <td className="numeric py-1.5 text-right text-ink">
                  {bar.display}
                  {bar.note ? ` (${bar.note})` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* DistributionStrip                                                           */
/* -------------------------------------------------------------------------- */

/** One bucket of a distribution. */
export interface DistributionBucket {
  readonly key: string
  readonly label: string
  readonly count: number
  /** True for a bucket whose values are below zero, so it can be marked as such. */
  readonly isNegative?: boolean
}

export interface DistributionStripProps {
  readonly title: string
  readonly caption?: ReactNode
  readonly buckets: readonly DistributionBucket[]
  /** What one observation is, e.g. "deals". */
  readonly unit: string
  /** Median and mean, shown together per KPI_CATALOG.md guidance on skewed measures. */
  readonly median?: { readonly label: string; readonly display: string } | null
  readonly mean?: { readonly label: string; readonly display: string } | null
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}

/**
 * A bucketed distribution, with its median and mean stated together.
 *
 * WHY BOTH CENTRES. `KPI_CATALOG.md` requires a skewed measure to show its median
 * beside its mean, because either alone invites the wrong conclusion: deal gross has
 * a long tail, so the mean sits above the typical deal, and a reader given only the
 * mean concludes the store is doing better than it is.
 *
 * The buckets come from the page, which builds them by counting exported deal-grain
 * rows into ranges. Counting rows into a range is a selection, not a new statistic:
 * no bucket average is computed, and the median shown is the one the export
 * publishes, never one reconstructed from these buckets.
 */
export function DistributionStrip({
  title,
  caption,
  buckets,
  unit,
  median,
  mean,
  headingLevel = 3,
  className,
}: DistributionStripProps) {
  const tableId = `distribution-${slug(title)}`
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
  const largest = buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0) || 1

  const centres = [median, mean].filter(
    (entry): entry is { label: string; display: string } => Boolean(entry)
  )
  const summary =
    `${String(total)} ${unit} across ${String(buckets.length)} band` +
    (buckets.length === 1 ? '' : 's') +
    (centres.length > 0
      ? `. ${centres.map((entry) => `${entry.label} ${entry.display}`).join(', ')}.`
      : '.')

  return (
    <ChartFrame
      title={title}
      caption={caption}
      summary={summary}
      headingLevel={headingLevel}
      className={className}
    >
      <ul aria-hidden="true" className="flex flex-col gap-2">
        {buckets.map((bucket) => (
          <li key={bucket.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-ink-secondary">
                {bucket.label}
              </span>
              <span className="numeric shrink-0 text-sm font-semibold text-ink">
                {String(bucket.count)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-pill bg-surface-sunken">
              <div
                className={cx('h-full', bucket.isNegative ? 'bg-ink-faint' : 'bg-accent/70')}
                style={{ width: `${String((bucket.count / largest) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      <TableDisclosure title={title}>
        <table id={tableId} className="w-full border-collapse text-sm">
          <caption className="sr-only">{`${title}. ${summary}`}</caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Band
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                {unit.charAt(0).toUpperCase() + unit.slice(1)}
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.key} className="border-b border-line-subtle/60 last:border-0">
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {bucket.label}
                </th>
                <td className="numeric py-1.5 text-right text-ink">{String(bucket.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>
    </ChartFrame>
  )
}

/**
 * Sort helper shared by the callers: order exact values ascending.
 *
 * Exported so a page never reaches for `Number()` to sort a monetary column.
 */
export function compareExactAscending(a: Exact | null, b: Exact | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return compareExact(a, b)
}

/** The zero every caller needs when a series legitimately has no value yet. */
export const EXACT_ZERO_CENTS = exactZero(2)
