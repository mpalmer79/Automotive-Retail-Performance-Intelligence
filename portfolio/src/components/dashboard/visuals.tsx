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
 * Three primitives arrived with the Sales and Gross page:
 *
 *   `TrendChart`         a value over time
 *   `BridgeChart`        a waterfall, for the gross-change decomposition
 *   `DistributionStrip`  a bucketed distribution, for deal-level gross
 *
 * Five more arrive with the Executive Overview's visual overhaul, for the same reason
 * and under the same rules -- each one exists because a page renders it, not because a
 * chart taxonomy has a gap:
 *
 *   `ExecutiveMicroTrend`  a KPI card's own shape over the trailing months
 *   `StoreComparisonBars`  one measure across the stores in scope
 *   `InventoryAgeStack`    the age distribution as one part-to-whole bar
 *   `GrossComposition`     front against back, as one part-to-whole bar
 *   `ReconciliationScale`  signed GL-versus-subledger variance around a zero rule
 *
 * The pace/bullet primitive the backlog reserved is `pace-bar.tsx`, which `DASH.5`
 * built with the target data it encodes. A funnel primitive is still not built: the
 * Executive Overview's funnel is rendered by its own component against its own five
 * governed stages, and an abstraction over one call site is a guess about the second.
 *
 * WHY THE FIVE TAKE `MetricResult` AND `Exact`, NOT `number`
 * ----------------------------------------------------------
 * A primitive that took a `number` could not tell a measured zero from "Not
 * applicable", and would draw a zero-length bar for a store that is not in the
 * business being measured -- which is the exact defect the structural-absence rule in
 * `executive.ts` exists to prevent. So the comparison primitive takes a whole
 * `MetricResult` and renders four of its five states as words with no bar at all.
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
import type { MetricResult } from '@/lib/dashboard/selectors'
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

/** A percentage, as CSS wants it, from a fraction. Layout only. */
function percent(fraction: number): string {
  return `${String(Math.round(fraction * 1000) / 10)}%`
}

/**
 * The vertical extent a column series is drawn against.
 *
 * ONE IMPLEMENTATION, TWO CALLERS. `TrendChart` and `ExecutiveMicroTrend` draw the same
 * picture at two sizes, and two copies of this arithmetic would eventually disagree
 * about where the baseline sits -- which is the one thing about a column chart a reader
 * cannot check by looking.
 *
 * THE BASELINE IS ALWAYS ZERO for a non-negative series, because a truncated baseline
 * misstates every ratio a reader takes off the picture. Where the series contains
 * negatives the axis runs from the minimum to the maximum and the caller draws a zero
 * rule, so the sign is visible rather than implied.
 *
 * Geometry only: every number here came through `exactToApproxNumber`, and no displayed
 * figure is derived from one.
 */
export interface ColumnGeometry {
  readonly minimum: number
  readonly maximum: number
  /** Never zero, so a caller may divide by it. */
  readonly span: number
  /** Where the zero rule sits, as a fraction of the span from the bottom. */
  readonly zeroOffset: number
}

export function columnGeometry(values: readonly (Exact | null)[]): ColumnGeometry {
  const numbers = values
    .filter((value): value is Exact => value !== null)
    .map((value) => exactToApproxNumber(value))
  const maximum = numbers.length > 0 ? Math.max(...numbers, 0) : 0
  const minimum = numbers.length > 0 ? Math.min(...numbers, 0) : 0
  const span = maximum - minimum || 1
  return { minimum, maximum, span, zeroOffset: (0 - minimum) / span }
}

/**
 * The disclosure carrying a chart's data table.
 *
 * `<details>` keeps the table in the document -- and therefore in the accessibility
 * tree's reading order and in a browser text search -- while collapsing it visually.
 * The e2e suite reads it with `textContent` for exactly that reason.
 */
export function TableDisclosure({
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
export function ChartFrame({
  title,
  caption,
  summary,
  summaryMode = 'visible',
  headingLevel = 3,
  className,
  children,
}: {
  readonly title: string
  readonly caption?: ReactNode
  /** One sentence stating what the visual shows, with its exact values. */
  readonly summary: string
  /**
   * Whether the summary is drawn, or carried for assistive technology only.
   *
   * IT IS ALWAYS IN THE DOCUMENT. `sr-only` moves a sentence out of the eye path; it
   * never removes it, and the accessible name of the figure is identical either way.
   *
   * The distinction is whether a sighted reader learns anything from reading it. A
   * summary that says "retail units by month, December highest" beside a chart whose
   * bars are labelled with months and values is telling them what they can already see,
   * and three of those on one page is what makes a dashboard read like a report. A
   * summary that names a basis, a denominator or a threshold the geometry cannot show is
   * load-bearing and stays visible.
   *
   * The rule this encodes: hide the summary when the title, the direct labels and the
   * values already carry it. Never hide a caveat.
   */
  readonly summaryMode?: 'visible' | 'sr-only'
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
  readonly children: ReactNode
}) {
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4'
  return (
    <figure className={cx('flex flex-col gap-4', className)}>
      <figcaption className="flex flex-col gap-1.5">
        <Heading className="text-base font-semibold text-ink">{title}</Heading>
        {caption ? (
          <p className="text-sm leading-normal text-ink-muted">{caption}</p>
        ) : null}
        <p
          className={
            summaryMode === 'sr-only'
              ? 'sr-only'
              : 'text-sm leading-normal text-ink-secondary'
          }
        >
          {summary}
        </p>
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
  const geometry = columnGeometry(points.map((point) => point.value))
  const { minimum, span } = geometry
  const zeroOffset = geometry.zeroOffset * 100
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
                    // The series colour is the categorical primary, NOT green: a
                    // period above zero is not thereby a good period, and most of
                    // what this chart plots has no favourable direction. Only the
                    // crossing of zero is coloured, and the zero rule is drawn.
                    negative ? 'bg-data-negative' : 'bg-data-primary'
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
              <tr
                key={point.key}
                className="border-b border-line-subtle/60 last:border-0"
              >
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
 *
 * WHY THE STEPS ARE THE ONLY THING THIS PAGE COLOURS BY SIGN. A waterfall step IS a
 * signed contribution to a total -- it added to the total or it subtracted from it,
 * and that is a fact about the arithmetic rather than a judgement about the business.
 * The anchors take the neutral reference fill because a level is not a direction.
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
                    ? 'bg-data-reference'
                    : falling
                      ? 'bg-data-negative'
                      : 'bg-data-positive'
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
                className={cx(
                  'h-full',
                  // A band BELOW ZERO, not a band that is worse. The bands above
                  // zero are one categorical colour, because a distribution has no
                  // favourable end and shading them would invent one.
                  bucket.isNegative ? 'bg-data-negative' : 'bg-data-primary'
                )}
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
              <tr
                key={bucket.key}
                className="border-b border-line-subtle/60 last:border-0"
              >
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {bucket.label}
                </th>
                <td className="numeric py-1.5 text-right text-ink">
                  {String(bucket.count)}
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
/* ExecutiveMicroTrend                                                         */
/* -------------------------------------------------------------------------- */

/** One point of a KPI card's trailing shape. */
export interface MicroTrendPoint {
  readonly key: string
  /** The month a reader reads, e.g. "November 2025". */
  readonly label: string
  /** `null` renders a GAP, never a zero. */
  readonly value: Exact | null
  /** The value as the reader should see it, already formatted by the card's unit. */
  readonly display: string
  /** True for the point the selected period resolves to. */
  readonly isCurrent: boolean
}

export interface ExecutiveMicroTrendProps {
  /** What the values are, e.g. "Retail units". Used in the accessible sentence. */
  readonly measure: string
  readonly points: readonly MicroTrendPoint[]
  /** `lead` cards carry a taller strip than the four that qualify them. */
  readonly size?: 'lead' | 'supporting'
  /**
   * Whether the first and last period labels are drawn under the columns.
   *
   * The KPI rail turns them OFF and prints the same range on the card's own metadata line,
   * beside the catalogue identifier. That is one rendered row rather than two for the same
   * two words, and on a rail of three cards inside a first-viewport contract it is 18 px
   * that a chart gets instead. The `sr-only` list carrying every month and every value is
   * unaffected either way: it is what a screen-reader user reads, and it is complete.
   */
  readonly axisLabels?: boolean
  readonly className?: string
}

/**
 * A KPI card's own shape over the trailing months.
 *
 * WHY THE CARD HAS ONE NOW AND DID NOT BEFORE. `kpi-strip.tsx` recorded the reason it
 * shipped without one: "a trend line needs a shape a reader can check, and the trend
 * page that owns it is `DASH.3`". That page shipped, the shape is checkable against it,
 * and a headline figure with no context is the thing an operating console is worst at.
 *
 * IT IS NOT A SPARKLINE. A line implies the quantity existed between the points, which
 * is true of a temperature and false of a month's gross. Columns, for the reason
 * `TrendChart` gives at length.
 *
 * THE CURRENT MONTH IS MARKED BY WEIGHT, NOT BY HUE. The selected period's column
 * carries the full accent and the others carry a muted one; nothing about which column
 * is current is available only as a colour, because the accessible sentence names it.
 *
 * NO TABLE DISCLOSURE. Seven of these on one page would be seven more `<details>` on the
 * largest document on the site. The accessible equivalent is a visually-hidden list
 * carrying every label and every value, which is complete, in reading order, and found
 * by a browser text search -- the three properties the table was there for.
 */
export function ExecutiveMicroTrend({
  measure,
  points,
  size = 'supporting',
  axisLabels = true,
  className,
}: ExecutiveMicroTrendProps) {
  const present = points.filter((point) => point.value !== null)
  if (present.length === 0) return null

  const { minimum, span, zeroOffset } = columnGeometry(points.map((point) => point.value))
  const missing = points.length - present.length
  const current = points.find((point) => point.isCurrent)

  /*
   * The summary deliberately does NOT open with the measure name. It renders directly
   * after the card's comparison line ("...lower than November 2025"), and a sentence
   * beginning "Aged inventory percentage" there produced the string "lower than November
   * 2025 Aged inventory percentage" in the page's flattened text -- which reads as an
   * asserted reduction in a dealership outcome, and which `content-integrity.spec.ts`
   * rejects on every route for exactly that reason. The measure is the card's own
   * heading two elements above; repeating it here bought nothing and cost a claim.
   */
  const summary =
    `Trailing ${String(points.length)} month` +
    (points.length === 1 ? '' : 's') +
    (current === undefined
      ? ', with no single month selected.'
      : ` to ${current.label}, ending at ${current.display}.`) +
    (missing > 0
      ? ` ${String(missing)} month${missing === 1 ? ' has' : 's have'} no value and appear as a gap.`
      : '')

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <p className="sr-only">{summary}</p>
      {/* The values, as text, for assistive technology and for a text search. The bars
          repeat them visually, so announcing both would read every figure twice. */}
      {/*
        The measure names the LIST rather than the summary sentence. An accessible name
        on the region gives a screen-reader user the identification the sentence used to
        carry, without putting the measure back into the page's flattened text directly
        after the card's comparison line -- see the note on `summary` above.
      */}
      <ul className="sr-only" aria-label={`${measure} by month`}>
        {points.map((point) => (
          <li key={point.key}>{`${point.label}: ${point.display}`}</li>
        ))}
      </ul>

      <div
        aria-hidden="true"
        className={cx(
          'relative flex items-end gap-0.5 border-b border-line-subtle',
          size === 'lead' ? 'h-8' : 'h-5'
        )}
      >
        {minimum < 0 ? (
          <span
            className="absolute inset-x-0 border-t border-dashed border-line"
            style={{ bottom: percent(zeroOffset) }}
          />
        ) : null}
        {points.map((point) => {
          if (point.value === null) {
            return <span key={point.key} className="min-w-0 flex-1" />
          }
          const value = exactToApproxNumber(point.value)
          const height = Math.abs(value) / span
          const negative = value < 0
          return (
            <span
              key={point.key}
              className="relative flex h-full min-w-0 flex-1 items-end"
            >
              <span
                className={cx(
                  'w-full rounded-t-xs',
                  // Two encodings, and neither is a verdict. Opacity says WHICH
                  // month you are reading -- the card's headline figure is the
                  // solid one -- and hue says only whether the month fell below
                  // zero, which the dashed zero rule above also shows.
                  negative
                    ? point.isCurrent
                      ? 'bg-data-negative'
                      : 'bg-data-negative/40'
                    : point.isCurrent
                      ? 'bg-data-primary'
                      : 'bg-data-primary/35'
                )}
                style={{
                  height: percent(Math.max(height, 0.02)),
                  marginBottom: negative
                    ? percent(Math.max(zeroOffset - height, 0))
                    : percent(zeroOffset),
                }}
              />
            </span>
          )
        })}
      </div>
      {axisLabels ? (
        <p aria-hidden="true" className="flex justify-between text-2xs text-ink-faint">
          <span>{microTrendAxisStart(points)}</span>
          <span>{microTrendAxisEnd(points)}</span>
        </p>
      ) : null}
    </div>
  )
}

/** The first period label, without its year. Exported so a caller can print the axis. */
export function microTrendAxisStart(points: readonly MicroTrendPoint[]): string {
  return points[0]?.label.replace(/ \d{4}$/, '') ?? ''
}

/** The last period label, without its year. */
export function microTrendAxisEnd(points: readonly MicroTrendPoint[]): string {
  return points[points.length - 1]?.label.replace(/ \d{4}$/, '') ?? ''
}

/* -------------------------------------------------------------------------- */
/* StoreComparisonBars                                                         */
/* -------------------------------------------------------------------------- */

/** One store's value for the compared measure. */
export interface ComparisonBarRow {
  readonly key: string
  readonly storeShortName: string
  readonly storeType: string
  /** The whole result, so four of the five states render as words and no bar. */
  readonly result: MetricResult
  /** The value as the reader should see it, or the state label. */
  readonly display: string
}

/**
 * The categorical store marks, one class per step, written out in full so Tailwind's
 * source scan can see them.
 */
const STORE_MARKS = ['bg-data-primary', 'bg-data-secondary', 'bg-data-tertiary'] as const

const STORE_MARK_FALLBACK = 'bg-data-primary'

/**
 * A store's mark colour. IDENTITY, NEVER RANK.
 *
 * DERIVED FROM THE BUSINESS CODE, NOT FROM THE ROW'S POSITION. A store filtered out of
 * scope would otherwise shift the colour of every store after it, and a reader who
 * learned that the independent pre-owned centre is the violet one would be reading a
 * different store's figure one filter change later. `GSA-002` is the second mark whether
 * or not `GSA-001` is on screen.
 *
 * ORDER CARRIES NO MEANING. The sequence is the business code, which is an identifier;
 * it is not a ranking, and the palette steps are not ordered from good to bad. The three
 * stores run different operating models and this console publishes no league table over
 * them -- the caption beside the bars says so in words.
 *
 * A code outside the `GSA-###` shape falls back to a character sum, so an unexpected
 * identifier still gets ONE stable colour rather than a colour that moves.
 */
export function storeMarkClass(storeId: string): string {
  const suffix = /(\d+)$/.exec(storeId)
  const ordinal =
    suffix?.[1] === undefined
      ? [...storeId].reduce((sum, character) => sum + character.charCodeAt(0), 0)
      : Number(suffix[1]) - 1
  const index = ((ordinal % STORE_MARKS.length) + STORE_MARKS.length) % STORE_MARKS.length
  return STORE_MARKS[index] ?? STORE_MARK_FALLBACK
}

export interface StoreComparisonBarsProps {
  readonly title: string
  readonly caption?: ReactNode
  readonly kpiId: string | null
  readonly rows: readonly ComparisonBarRow[]
  /** Rendered instead of a comparison when the filter leaves one store in scope. */
  readonly singleStoreNotice?: ReactNode
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}

/**
 * One governed measure across the stores in scope.
 *
 * WHY THIS IS NOT THE SCOREBOARD. The scoreboard answers "what are all ten figures for
 * all three stores", which is a report and is correct as a table. This answers "which
 * store is different on the one measure I am looking at", which is a comparison, and a
 * comparison is what a length is actually good for. Both are on the page; this one is
 * above, because it is the question a general manager opens the console with.
 *
 * A STRUCTURAL ABSENCE DRAWS NOTHING. `executive.ts` replaces a measured zero with
 * `not-applicable` where a store cannot have the measure at all -- the independent
 * pre-owned centre has no new-vehicle franchise -- and a zero-length bar for that store
 * would re-create, geometrically, the exact defect that rule removes from the table. So
 * a non-`value` result renders its words and no track at all, and contributes nothing to
 * the scale the other stores are drawn against.
 *
 * NOTHING IS RANKED AND NOTHING IS COLOURED "BEST". Rows are in business-code order and
 * each carries its own store's hue, for the reason `store-scoreboard.tsx` records: three
 * different operating models, and a league table over them would be a finding this
 * console may not publish. See `storeMarkClass` for why the hue cannot drift.
 *
 * THE SUMMARY IS `sr-only`. Every row below prints its store's name and its value as
 * text, so a visible copy of the summary sentence is the same figures read twice. It
 * stays in the accessibility tree, where it is the one sentence that carries the whole
 * comparison without asking a reader to interpret a length.
 */
export function StoreComparisonBars({
  title,
  caption,
  kpiId,
  rows,
  singleStoreNotice,
  headingLevel = 3,
  className,
}: StoreComparisonBarsProps) {
  const drawable = rows.filter((row) => row.result.kind === 'value')
  const largest = drawable.reduce(
    (max, row) =>
      row.result.kind === 'value'
        ? Math.max(max, exactToApproxNumber(row.result.value))
        : max,
    0
  )

  const summary =
    drawable.length === 0
      ? `No store in scope resolves ${title.toLowerCase()}.`
      : `${title} across ${String(rows.length)} store${rows.length === 1 ? '' : 's'}: ` +
        `${rows.map((row) => `${row.storeShortName} ${row.display}`).join(', ')}.`

  return (
    <ChartFrame
      title={title}
      caption={caption}
      summary={summary}
      summaryMode="sr-only"
      headingLevel={headingLevel}
      className={className}
    >
      {kpiId === null ? null : (
        <p className="font-mono text-2xs tracking-wide text-ink-faint">{kpiId}</p>
      )}

      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const resolved = row.result.kind === 'value'
          const width =
            resolved && largest > 0 ? exactToApproxNumber(row.result.value) / largest : 0
          return (
            <li key={row.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-ink-secondary">
                  {row.storeShortName}
                </span>
                <span
                  className={cx(
                    'shrink-0 text-sm',
                    resolved
                      ? 'numeric font-semibold text-ink'
                      : 'font-medium text-ink-muted'
                  )}
                >
                  {row.display}
                </span>
              </div>
              {resolved ? (
                <div
                  aria-hidden="true"
                  className="h-2 w-full overflow-hidden rounded-pill bg-surface-sunken"
                >
                  {/* Zero stays zero. A minimum-width bar for a store that sold nothing
                      would draw a quantity the data does not have. */}
                  <div
                    className={`h-full rounded-pill ${storeMarkClass(row.key)}`}
                    style={{ width: percent(width) }}
                  />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {singleStoreNotice === undefined ? null : (
        <p className="text-xs leading-normal text-ink-muted">{singleStoreNotice}</p>
      )}

      <TableDisclosure title={title}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{`${title}. ${summary}`}</caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Store
              </th>
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Operating model
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                {title}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-line-subtle/60 last:border-0">
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {row.storeShortName}
                </th>
                <td className="py-1.5 pr-3 text-ink-muted">{row.storeType}</td>
                <td className="numeric py-1.5 text-right text-ink">{row.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* InventoryAgeStack                                                           */
/* -------------------------------------------------------------------------- */

/** One age bucket, ready to render. */
export interface AgeStackSegment {
  readonly key: string
  readonly label: string
  /** The unit count, already formatted. */
  readonly display: string
  /**
   * The bucket's share of the whole population, `0`-`1`.
   *
   * Computed by the view model against the POPULATION, not against the largest bucket:
   * a distribution divided by its own mode is not a distribution, and the bars this
   * replaced were drawn that way.
   */
  readonly share: number
  /**
   * The bucket's capital, already formatted, and its share of the total investment.
   *
   * OPTIONAL, AND PRESENT ONLY BECAUSE THE EXPORT ALREADY PUBLISHES IT.
   * `inventory-aging` carries `investment_in_bucket` at the same grain as
   * `units_in_bucket` — one row per store per snapshot date per condition group per age
   * bucket — so the capital track is the same selection over the same rows and needs no
   * export change, no new grain and no inference. Where a caller has no capital to hand,
   * both fields are absent and the track is not drawn at all rather than drawn from an
   * estimate.
   *
   * WHY IT IS A SECOND TRACK AND NOT A SECOND CHART. Units and dollars over the same five
   * bands is the comparison a used-car manager actually makes: eleven per cent of the
   * units and twenty-six per cent of the money is the finding, and it is invisible unless
   * the two distributions are read against each other on one set of bands.
   */
  readonly capitalDisplay?: string
  readonly capitalShare?: number
}

export interface InventoryAgeStackProps {
  readonly title: string
  readonly caption?: ReactNode
  readonly segments: readonly AgeStackSegment[]
  /** Named so a reader knows the position is read at one date. */
  readonly snapshotNote: string
  /**
   * The aged threshold in days, when the scope in view carries exactly one.
   *
   * Rendered in the legend because the ramp turns amber at it. It is an ARPI
   * PROJECT DEFAULT and the legend says so: the ramp would otherwise read as an
   * industry standard nobody published.
   */
  readonly thresholdDays?: number | null
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}

/**
 * The ordered age ramp, one class per step, written out in full.
 *
 * WRITTEN OUT BECAUSE TAILWIND SCANS SOURCE TEXT. A template literal built from a
 * token name produces a class that is never emitted, and the segment renders with no
 * background at all.
 *
 * THE RAMP IS KEYED ON EXPORTED BUCKET ORDER, NOT ON A DAY COUNT. The aging export
 * enumerates five buckets and publishes `age_bucket_sort_order`; the view model sorts
 * on it and this reads the result. Nothing here parses a label for a number, so a
 * bucket boundary can move in the warehouse without this file agreeing or disagreeing
 * with it. A sixth bucket would hold at the last step rather than invent a colour, and
 * its printed range and count would still be correct.
 */
const AGE_RAMP = [
  'bg-data-age-fresh',
  'bg-data-age-early',
  'bg-data-age-threshold',
  'bg-data-age-aged',
  'bg-data-age-critical',
] as const

const AGE_RAMP_LAST = 'bg-data-age-critical'

function ageRampClass(index: number): string {
  return AGE_RAMP[index] ?? AGE_RAMP_LAST
}

/**
 * The age distribution as one part-to-whole bar, plus its table.
 *
 * TWO COMPOSITIONS, NOT ONE SCALED DOWN. Five segments across the 280px a 320px phone
 * actually offers puts the smallest bucket under eight pixels, so below `sm` the stack
 * runs vertically as full-width rows and above it runs horizontally. Both are in the
 * document and each is `display: none` at the other's width, which is what keeps exactly
 * one of them in the accessibility tree -- the technique `store-scoreboard.tsx` uses for
 * its two presentations of a row.
 *
 * THE SEGMENTS ARE `aria-hidden` AND EVERY COUNT IS TEXT. The legend below the bar
 * carries each bucket and its unit count, and the table carries all of it again.
 *
 * THE SUMMARY IS `sr-only`. The legend prints every band's range and count, and the
 * table below prints all of it again, so the visible page already carries the sentence.
 *
 * COLOUR ORDERS THE BANDS AND CARRIES NOTHING ALONE. The ramp runs fresh green to
 * severely-aged rose across the exported bucket order. Adjacent steps are not 3:1 from
 * each other -- see the recorded limitation in `tokens.css` -- so the bands are also
 * separated by a gap of the page background, and every band's range and count are
 * printed beside it. A reader who cannot separate two hues still reads the numbers.
 */
export function InventoryAgeStack({
  title,
  caption,
  segments,
  snapshotNote,
  thresholdDays = null,
  headingLevel = 3,
  className,
}: InventoryAgeStackProps) {
  // Keyed on the position in `segments`, not in the filtered list: an empty bucket
  // must not shift the colour of the bucket after it, or the bar and the legend
  // disagree about which band is which.
  const drawable = segments
    .map((segment, index) => ({ segment, index }))
    .filter((entry) => entry.segment.share > 0)
  const summary =
    segments.length === 0
      ? 'No inventory rows fall inside the selected period and scope.'
      : `${String(segments.length)} age bands. ` +
        segments.map((segment) => `${segment.label}: ${segment.display}`).join(', ') +
        `. ${snapshotNote}`

  if (segments.length === 0) {
    return (
      <ChartFrame
        title={title}
        caption={caption}
        summary={summary}
        summaryMode="sr-only"
        headingLevel={headingLevel}
        className={className}
      >
        {null}
      </ChartFrame>
    )
  }

  /*
   * The capital track is drawn only when EVERY drawn band carries one. A stack missing a
   * band is not a distribution, and a partial capital bar beside a complete unit bar
   * would invite exactly the comparison it cannot support.
   */
  const capital = drawable.every((entry) => entry.segment.capitalShare !== undefined)
    ? drawable
    : []

  return (
    <ChartFrame
      title={title}
      caption={caption}
      summary={summary}
      summaryMode="sr-only"
      headingLevel={headingLevel}
      className={className}
    >
      {/* Horizontal, at `sm` and above. Units, then capital over the same bands. */}
      <div className="hidden flex-col gap-2 sm:flex">
        <StackTrack
          label={capital.length === 0 ? null : 'Units'}
          entries={drawable}
          shareOf={(segment) => segment.share}
        />
        {capital.length === 0 ? null : (
          <StackTrack
            label="Investment"
            entries={capital}
            shareOf={(segment) => segment.capitalShare ?? 0}
          />
        )}
      </div>

      {/* Vertical, below `sm`. The same geometry read down the page. */}
      <ul aria-hidden="true" className="flex flex-col gap-1.5 sm:hidden">
        {segments.map((segment, index) => (
          <li key={segment.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-ink-secondary">{segment.label}</span>
              <span className="numeric text-xs font-semibold text-ink">
                {segment.display}
                {segment.capitalDisplay === undefined
                  ? ''
                  : ` · ${segment.capitalDisplay}`}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-pill bg-surface-sunken">
              <div
                className={`h-full rounded-pill ${ageRampClass(index)}`}
                style={{ width: percent(segment.share) }}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* The legend, at `sm` and above. Below it the vertical bars are their own. */}
      <ul className="hidden flex-wrap gap-x-5 gap-y-1.5 sm:flex">
        {segments.map((segment, index) => (
          <li
            key={segment.key}
            className="flex items-baseline gap-1.5 text-xs text-ink-muted"
          >
            <span
              aria-hidden="true"
              className={`inline-block size-2.5 shrink-0 translate-y-px rounded-xs ${ageRampClass(index)}`}
            />
            <span>{segment.label}</span>
            <span className="numeric font-semibold text-ink">{segment.display}</span>
            {segment.capitalDisplay === undefined ? null : (
              <span className="numeric text-ink-muted">{segment.capitalDisplay}</span>
            )}
          </li>
        ))}
      </ul>

      <TableDisclosure title="age bucket">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Active inventory units by age bucket at the snapshot date
          </caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Days in stock
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
                Units
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
                Share of units
              </th>
              {capital.length === 0 ? null : (
                <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                  Investment
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {segments.map((segment) => (
              <tr
                key={segment.key}
                className="border-b border-line-subtle/60 last:border-0"
              >
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {segment.label}
                </th>
                <td className="numeric py-1.5 pr-3 text-right text-ink">
                  {segment.display}
                </td>
                <td className="numeric py-1.5 pr-3 text-right text-ink-muted">
                  {`${(segment.share * 100).toFixed(1)}%`}
                </td>
                {capital.length === 0 ? null : (
                  <td className="numeric py-1.5 text-right text-ink">
                    {segment.capitalDisplay ?? 'No value'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>

      {/* The threshold the ramp turns on, named as the project default it is. */}
      {thresholdDays === null ? null : (
        <p className="text-2xs text-ink-faint">
          Ramp turns at the{' '}
          <span className="numeric font-semibold text-ink-muted">
            {thresholdDays}-day
          </span>{' '}
          aged threshold, an ARPI project default rather than an industry benchmark. A
          unit past it may sit in any bucket above it.
        </p>
      )}
    </ChartFrame>
  )
}

/**
 * One part-to-whole track of the age stack, with an optional track name beside it.
 *
 * Extracted because the stack draws the same geometry twice — once over units and once
 * over capital — and two copies of a part-to-whole bar would eventually disagree about
 * the surface gap that holds two adjacent ramp steps apart when their contrast does not.
 * The track name appears ONLY when there are two tracks: a single unlabelled bar under a
 * heading that already says what it is does not need a second label.
 */
function StackTrack({
  label,
  entries,
  shareOf,
}: {
  readonly label: string | null
  readonly entries: readonly {
    readonly segment: AgeStackSegment
    readonly index: number
  }[]
  readonly shareOf: (segment: AgeStackSegment) => number
}) {
  return (
    <div className="flex items-center gap-2">
      {label === null ? null : (
        <span className="w-20 shrink-0 font-mono text-2xs tracking-wide text-ink-muted uppercase">
          {label}
        </span>
      )}
      <div
        aria-hidden="true"
        data-stack-track={label === null ? 'units' : label.toLowerCase()}
        className="flex h-4 w-full overflow-hidden rounded-pill bg-surface-sunken"
      >
        {entries.map((entry, position) => (
          <div
            key={entry.segment.key}
            className={`h-full ${ageRampClass(entry.index)}`}
            style={{
              width: percent(shareOf(entry.segment)),
              // A 2px surface gap rather than a stroke: a stroked boundary reads as
              // data-weight ink that is not data. Only between segments. It is also
              // what holds two adjacent ramp steps apart when their contrast does not.
              marginRight: position < entries.length - 1 ? '2px' : undefined,
            }}
          />
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* GrossComposition                                                            */
/* -------------------------------------------------------------------------- */

/** One component of a total. */
export interface CompositionSegment {
  readonly key: string
  readonly label: string
  readonly value: Exact
  readonly display: string
}

export interface GrossCompositionProps {
  readonly title: string
  readonly caption?: ReactNode
  readonly segments: readonly CompositionSegment[]
  /**
   * The GOVERNED total, used as the denominator.
   *
   * Not a sum of the segments: a component may not perform exact arithmetic, and a
   * denominator assembled here could disagree with the total the KPI row already shows.
   * `null` withholds the whole geometry and renders the reason.
   */
  readonly total: Exact | null
  /**
   * The qualification a reader needs to read the bar correctly, behind a disclosure.
   *
   * A caveat whose removal would make the picture misleading belongs in the caption
   * instead. This is for the paragraph that explains how to think about a share the
   * console deliberately does not rank — necessary, and not necessary before the bar.
   */
  readonly shareDisclosure?: string
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}

/**
 * Two components of a governed total, as one part-to-whole bar.
 *
 * A NEGATIVE COMPONENT IS REAL AND BREAKS THE STACK. A store can close a month with a
 * negative front-end gross -- `gross-summary` publishes `negative_front_gross_units` and
 * the Deal Explorer shows the deals -- and a signed quantity cannot be a slice of a
 * hundred percent. Where any component is negative, or the total is zero or absent, the
 * bar is withheld entirely and the amounts are rendered as figures with their signs. A
 * stack drawn over a negative component would be a picture of something that did not
 * happen, which is worse than no picture.
 *
 * THE SUMMARY IS `sr-only`: the definition list below prints each component's label and
 * amount, which is the whole of that sentence.
 *
 * NEITHER COMPONENT IS RANKED AGAINST THE OTHER, for the reason
 * `sales-gross-sections.tsx` records: a store can hold total gross steady while front
 * collapses and the finance office compensates, and which of those is preferable depends
 * on the store rather than on the figure. The two fills are therefore the CATEGORICAL
 * pair -- two identities -- and never the positive/negative pair, which would say the
 * finance office is the good half of the deal.
 */

/** The two component fills. Identity, in segment order, and not a ranking. */
const COMPOSITION_MARKS = ['bg-data-primary', 'bg-data-secondary'] as const

const COMPOSITION_MARK_FALLBACK = 'bg-data-tertiary'

function compositionMarkClass(index: number): string {
  return COMPOSITION_MARKS[index] ?? COMPOSITION_MARK_FALLBACK
}

export function GrossComposition({
  title,
  caption,
  segments,
  total,
  shareDisclosure,
  headingLevel = 3,
  className,
}: GrossCompositionProps) {
  const totalNumber = total === null ? 0 : exactToApproxNumber(total)
  const anyNegative = segments.some((segment) => isNegative(segment.value))
  const drawable = total !== null && totalNumber > 0 && !anyNegative

  const summary =
    segments.length === 0
      ? `No ${title.toLowerCase()} resolves for this scope.`
      : `${segments.map((segment) => `${segment.label} ${segment.display}`).join(', ')}.`

  return (
    <ChartFrame
      title={title}
      caption={caption}
      summary={summary}
      summaryMode="sr-only"
      headingLevel={headingLevel}
      className={className}
    >
      {drawable ? (
        <div
          aria-hidden="true"
          className="flex h-4 w-full overflow-hidden rounded-pill bg-surface-sunken"
        >
          {segments.map((segment, index) => (
            <div
              key={segment.key}
              className={`h-full ${compositionMarkClass(index)}`}
              style={{
                width: percent(exactToApproxNumber(segment.value) / totalNumber),
                marginRight: index < segments.length - 1 ? '2px' : undefined,
              }}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs leading-normal text-ink-muted">
          {anyNegative
            ? 'A component is negative, so the composition is not drawn as a share of the total. A signed amount is not a slice of a whole, and the figures below carry their signs.'
            : 'The total is zero or unavailable for this scope, so no share is defined.'}
        </p>
      )}

      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {segments.map((segment, index) => (
          <div key={segment.key} className="flex min-w-0 flex-col gap-0.5">
            <dt className="flex items-baseline gap-1.5 font-mono text-2xs tracking-wide text-ink-muted uppercase">
              <span
                aria-hidden="true"
                className={`inline-block size-2.5 shrink-0 translate-y-px rounded-xs ${compositionMarkClass(index)}`}
              />
              {segment.label}
            </dt>
            <dd className="numeric text-sm font-semibold text-ink">{segment.display}</dd>
          </div>
        ))}
      </dl>

      {shareDisclosure === undefined ? null : (
        <details className="rounded-lg border border-line-subtle bg-surface-sunken/50">
          <summary className="flex min-h-touch cursor-pointer items-center px-3 text-xs font-medium text-ink-muted transition-colors duration-(--arpi-motion-fast) hover:text-accent">
            How to read this
          </summary>
          <p className="px-3 pb-3 text-sm leading-normal text-ink-secondary">
            {shareDisclosure}
          </p>
        </details>
      )}
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* ReconciliationScale                                                         */
/* -------------------------------------------------------------------------- */

/** One control-account position on the scale. */
export interface ScaleAccount {
  readonly key: string
  readonly label: string
  /** GL minus subledger. `null` where one side is absent. */
  readonly variance: Exact | null
  readonly display: string
  /** The governed comparison state, in words. */
  readonly state: string
  readonly isComparable: boolean
}

export interface ReconciliationScaleProps {
  readonly title: string
  readonly caption?: ReactNode
  readonly accounts: readonly ScaleAccount[]
  /** The signed group total, already formatted, and the direction in words. */
  readonly totalDisplay: string
  readonly directionText: string
  /** Positions excluded from the geometry because a side is absent. */
  readonly excludedCount: number
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}

/**
 * Signed GL-versus-subledger variance, positioned around a zero rule.
 *
 * NO SIGN COLOUR AT ALL, AND THE ABSENCE IS THE DESIGN. A variance is not a failure. The
 * export's own exception detail says it outright -- "BOTH SIDES ARE VALID DATA...  This
 * is a reconciliation finding to investigate, not a broken record" -- so a red marker
 * for one sign and a green one for the other would publish a judgement the console is
 * not authorized to make. The sign is carried three times instead: by the side of the
 * rule the marker sits on, by the printed amount, and by `directionText`.
 *
 * THIS SURVIVED THE SEMANTIC-COLOUR PASS DELIBERATELY. Every marker takes
 * `data-neutral`, the one token in the vocabulary that means "this mark is not a
 * verdict", and it takes the same token on both sides of zero. A future edit that
 * reaches for `data-positive` or `data-negative` here is reversing a decision, not
 * completing one; the test suite asserts the neutrality rather than trusting this note.
 *
 * A MISSING SIDE IS NOT A ZERO AND IS NOT PLOTTED. `accounting.ts` rule 2: a missing GL
 * balance and a GL balance of $0.00 are different facts, and the second is far more
 * alarming. Non-comparable positions are counted, named in the summary, and left off the
 * axis entirely rather than drawn at the centre where they would read as reconciled.
 *
 * TWO COMPOSITIONS. The shared axis needs room either side of zero, so below `md` each
 * account becomes its own labelled signed row.
 */
export function ReconciliationScale({
  title,
  caption,
  accounts,
  totalDisplay,
  directionText,
  excludedCount,
  headingLevel = 3,
  className,
}: ReconciliationScaleProps) {
  const plotted = accounts.filter(
    (account) => account.isComparable && account.variance !== null
  )
  const widest = plotted.reduce(
    (max, account) =>
      account.variance === null
        ? max
        : Math.max(max, Math.abs(exactToApproxNumber(account.variance))),
    0
  )

  const summary =
    `${String(plotted.length)} comparable position${plotted.length === 1 ? '' : 's'}, ` +
    `netting ${totalDisplay}: ${directionText}.` +
    (excludedCount > 0
      ? ` ${String(excludedCount)} position${excludedCount === 1 ? ' is' : 's are'} one-sided and carry no variance, so ${excludedCount === 1 ? 'it is' : 'they are'} counted rather than plotted.`
      : '')

  /** Where a marker sits, 0 at the left edge and 1 at the right, with zero at the centre. */
  const offsetOf = (variance: Exact): number =>
    widest === 0 ? 0.5 : 0.5 + exactToApproxNumber(variance) / widest / 2

  return (
    <ChartFrame
      title={title}
      caption={caption}
      summary={summary}
      headingLevel={headingLevel}
      className={className}
    >
      {/* The shared axis, at `md` and above. */}
      <div className="hidden flex-col gap-2 md:flex">
        <div
          aria-hidden="true"
          className="relative h-16 w-full rounded-lg border border-line-subtle bg-surface-sunken"
        >
          <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
          {plotted.map((account, index) => (
            <span
              key={account.key}
              className="absolute size-2.5 -translate-x-1/2 rounded-full border border-canvas bg-data-neutral"
              style={{
                left: percent(offsetOf(account.variance as Exact)),
                top: `${String(14 + index * 12)}%`,
              }}
            />
          ))}
        </div>
        <p
          aria-hidden="true"
          className="flex justify-between font-mono text-2xs tracking-wide text-ink-faint uppercase"
        >
          <span>Subledger carries more</span>
          <span>Balanced</span>
          <span>Ledger carries more</span>
        </p>
      </div>

      {/* Per-account signed rows, below `md` and as the legend above it. */}
      <ul className="flex flex-col gap-2">
        {accounts.map((account) => (
          <li key={account.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-ink-secondary">
                {account.label}
              </span>
              <span
                className={cx(
                  'shrink-0 text-sm',
                  account.variance === null
                    ? 'font-medium text-ink-muted'
                    : 'numeric font-semibold text-ink'
                )}
              >
                {account.display}
              </span>
            </div>
            <span className="text-2xs text-ink-faint">{account.state}</span>
            {account.isComparable && account.variance !== null ? (
              <div
                aria-hidden="true"
                className="relative h-1.5 w-full rounded-pill bg-surface-sunken md:hidden"
              >
                <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                <span
                  className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-data-neutral"
                  style={{ left: percent(offsetOf(account.variance)) }}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <TableDisclosure title={title}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{`${title}. ${summary}`}</caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Control account
              </th>
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                State
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Signed variance
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr
                key={account.key}
                className="border-b border-line-subtle/60 last:border-0"
              >
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {account.label}
                </th>
                <td className="py-1.5 pr-3 text-ink-muted">{account.state}</td>
                <td className="numeric py-1.5 text-right text-ink">{account.display}</td>
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
