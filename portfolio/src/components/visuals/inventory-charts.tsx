/**
 * The inventory visualisations.
 *
 * Server components, no client JavaScript, no charting library. Every chart on
 * these pages is a horizontal bar chart of one categorical breakdown, which is a
 * `<div>` per row and a width percentage. A dependency that renders that in a
 * canvas would cost more bytes than the whole dealership section and would take
 * the numbers out of the DOM, where both a screen reader and a text search can
 * currently find them.
 *
 * WHAT MAKES THESE ACCESSIBLE
 * ---------------------------
 * The bars are `aria-hidden` decoration. The DATA is a real `<table>` with a
 * caption, a row header per category and a numeric cell per value, and it is in
 * the document whether or not the reader opens it: `<details>` hides it visually
 * while leaving it in the accessibility tree's reading order, and every figure a
 * bar encodes is also printed as text beside that bar. Nothing is available only
 * as a length.
 *
 * Colour is never the only channel. Each chart is a single series unless it is
 * comparing stores, in which case the series carry a legend and a direct value
 * label. The three store hues were checked with a colour-vision validator
 * against the white surface; the choice and the measurements are recorded in
 * `lib/inventory.ts` above `ACCENT_PRESENTATION`.
 *
 * WHY THERE ARE ONLY FIVE
 * -----------------------
 * A chart per available breakdown would be a dozen, and a dozen small bar charts
 * is a wall rather than an argument. These five are the ones that carry the
 * story the page is making: the three stores are different sizes, they carry
 * different new-to-pre-owned mixes, the independent store is where the brand
 * spread lives, the model-year spread separates franchise from independent, and
 * the price bands show three different market positions.
 */
import type { ReactNode } from 'react'

import { CONDITION_SERIES, SINGLE_SERIES } from '@/lib/inventory'
import { cx, formatCount } from '@/lib/utils'

/** One row of a breakdown: a category, its value, and how it is drawn. */
export interface ChartRow {
  readonly key: string
  /** The category name, as a reader reads it. */
  readonly label: string
  readonly value: number
  /** A CSS colour. Defaults to the chart's single series hue. */
  readonly colour?: string
  /** Rendered after the value, e.g. a share of the total. */
  readonly note?: string
}

export interface BarChartProps {
  /** The chart's own heading. Becomes the table caption too. */
  readonly title: string
  /** What the numbers are, e.g. "listings". Used in the accessible summary. */
  readonly unit: string
  readonly rows: readonly ChartRow[]
  /** The single series colour, where the rows do not carry their own. */
  readonly colour?: string
  /** The column heading for the value column in the table view. */
  readonly valueHeading?: string
  /** Rendered under the title. One sentence. */
  readonly caption?: ReactNode
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}

/** The one hue every single-series chart uses. Declared once, in lib/inventory. */
const DEFAULT_SERIES = SINGLE_SERIES

/**
 * A horizontal bar chart with a table alternative.
 *
 * The scale is linear from zero to the largest value in the set. It is never
 * truncated and never logarithmic: a bar whose baseline is not zero misstates
 * every ratio a reader takes off it, and this chart's whole job is ratios.
 */
export function BarChart({
  title,
  unit,
  rows,
  colour = DEFAULT_SERIES,
  valueHeading = 'Listings',
  caption,
  headingLevel = 3,
  className,
}: BarChartProps) {
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4'
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  const largest = rows.reduce((max, row) => Math.max(max, row.value), 0)
  const tableId = `chart-table-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

  return (
    <figure className={cx('flex flex-col gap-4', className)}>
      <figcaption className="flex flex-col gap-1.5">
        <Heading className="text-base font-semibold text-ink">{title}</Heading>
        {caption ? (
          <p className="text-sm leading-normal text-ink-muted">{caption}</p>
        ) : null}
      </figcaption>

      {/* The bars.
          `aria-hidden`, because everything they encode is printed as text in the
          same row and again in the table below. A screen-reader user who was
          also read the bars would hear each figure three times. */}
      <ul aria-hidden="true" className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-ink-secondary">
                {row.label}
              </span>
              <span className="numeric shrink-0 text-sm font-semibold text-ink">
                {formatCount(row.value)}
                {row.note ? (
                  <span className="ml-1.5 font-normal text-ink-faint">{row.note}</span>
                ) : null}
              </span>
            </div>
            {/* The track is a lighter step of the surface, not a border: a
                stroked track reads as data-weight ink that is not data. */}
            <div className="h-2 w-full overflow-hidden rounded-pill bg-surface-sunken">
              <div
                className="h-full rounded-pill"
                style={{
                  // Zero stays zero. A minimum-width bar for an empty category
                  // would draw a quantity the data does not have.
                  width: largest === 0 ? '0%' : `${String((row.value / largest) * 100)}%`,
                  backgroundColor: row.colour ?? colour,
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* The table alternative.
          Present in the DOM, in reading order, collapsed by default so five
          charts do not become five tables on a phone. `<details>` keeps its
          contents in the accessibility tree, so this is a progressive disclosure
          rather than a hidden fallback. */}
      <details className="group/table rounded-lg border border-line-subtle bg-surface-sunken/50">
        <summary className="flex min-h-touch cursor-pointer items-center px-3 text-xs font-medium text-ink-muted transition-colors duration-(--arpi-motion-fast) hover:text-accent">
          {`Read ${title.toLowerCase()} as a table`}
        </summary>
        <div className="overflow-x-auto px-3 pb-3">
          <table id={tableId} className="w-full min-w-[18rem] text-left text-sm">
            <caption className="sr-only">
              {`${title}. ${formatCount(total)} ${unit} in total.`}
            </caption>
            <thead>
              <tr className="border-b border-line">
                <th
                  scope="col"
                  className="py-2 pr-4 text-xs font-semibold text-ink-muted"
                >
                  Category
                </th>
                <th
                  scope="col"
                  className="py-2 text-right text-xs font-semibold text-ink-muted"
                >
                  {valueHeading}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-line-subtle last:border-0">
                  <th scope="row" className="py-1.5 pr-4 font-normal text-ink-secondary">
                    {row.label}
                  </th>
                  <td className="numeric py-1.5 text-right text-ink">
                    {formatCount(row.value)}
                    {row.note ? (
                      <span className="ml-1.5 text-ink-faint">{row.note}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

/* -------------------------------------------------------------------------- */
/* StackedMixBar                                                               */
/* -------------------------------------------------------------------------- */

export interface MixRow {
  readonly key: string
  readonly label: string
  readonly newRecords: number
  readonly preOwnedRecords: number
}

export interface StackedMixBarProps {
  readonly title: string
  readonly rows: readonly MixRow[]
  readonly caption?: ReactNode
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}

/**
 * The new-versus-pre-owned mix, one hundred-percent stacked bar per store.
 *
 * Normalised to 100% on purpose. The absolute counts differ by more than an
 * order of magnitude between the three stores, so an unnormalised stack would
 * make the two smaller stores' mixes unreadable, and mix is the only thing this
 * chart is for. The absolute counts are one chart above and in the table below,
 * so nothing is lost by normalising here.
 *
 * The two segments are separated by a 2px gap in the surface colour rather than
 * by a stroke, and each segment carries its own count as text.
 */
export function StackedMixBar({
  title,
  rows,
  caption,
  headingLevel = 3,
  className,
}: StackedMixBarProps) {
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4'

  return (
    <figure className={cx('flex flex-col gap-4', className)}>
      <figcaption className="flex flex-col gap-1.5">
        <Heading className="text-base font-semibold text-ink">{title}</Heading>
        {caption ? (
          <p className="text-sm leading-normal text-ink-muted">{caption}</p>
        ) : null}
      </figcaption>

      {/* The legend. Always present, because there are two series. */}
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {(
          [
            ['New', CONDITION_SERIES.new],
            ['Pre-owned', CONDITION_SERIES['pre-owned']],
          ] as const
        ).map(([label, colour]) => (
          <li key={label} className="flex items-center gap-2 text-xs text-ink-muted">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 shrink-0 rounded-xs"
              style={{ backgroundColor: colour }}
            />
            {label}
          </li>
        ))}
      </ul>

      <ul aria-hidden="true" className="flex flex-col gap-3">
        {rows.map((row) => {
          const total = row.newRecords + row.preOwnedRecords
          const newShare = total === 0 ? 0 : (row.newRecords / total) * 100
          return (
            <li key={row.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-ink-secondary">
                  {row.label}
                </span>
                <span className="numeric shrink-0 text-xs text-ink-muted">
                  {`${formatCount(row.newRecords)} new / ${formatCount(row.preOwnedRecords)} pre-owned`}
                </span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken">
                {row.newRecords > 0 ? (
                  <div
                    className="h-full"
                    style={{
                      width: `${String(newShare)}%`,
                      backgroundColor: CONDITION_SERIES.new,
                      // The surface gap. Only where both segments exist, so a
                      // single-condition store does not draw a notch into
                      // nothing.
                      marginRight: row.preOwnedRecords > 0 ? '2px' : undefined,
                    }}
                  />
                ) : null}
                {row.preOwnedRecords > 0 ? (
                  <div
                    className="h-full flex-1"
                    style={{ backgroundColor: CONDITION_SERIES['pre-owned'] }}
                  />
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      <details className="rounded-lg border border-line-subtle bg-surface-sunken/50">
        <summary className="flex min-h-touch cursor-pointer items-center px-3 text-xs font-medium text-ink-muted transition-colors duration-(--arpi-motion-fast) hover:text-accent">
          {`Read ${title.toLowerCase()} as a table`}
        </summary>
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full min-w-[22rem] text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-line">
                <th
                  scope="col"
                  className="py-2 pr-4 text-xs font-semibold text-ink-muted"
                >
                  Store
                </th>
                <th
                  scope="col"
                  className="py-2 pr-4 text-right text-xs font-semibold text-ink-muted"
                >
                  New
                </th>
                <th
                  scope="col"
                  className="py-2 pr-4 text-right text-xs font-semibold text-ink-muted"
                >
                  Pre-owned
                </th>
                <th
                  scope="col"
                  className="py-2 text-right text-xs font-semibold text-ink-muted"
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-line-subtle last:border-0">
                  <th scope="row" className="py-1.5 pr-4 font-normal text-ink-secondary">
                    {row.label}
                  </th>
                  <td className="numeric py-1.5 pr-4 text-right text-ink">
                    {formatCount(row.newRecords)}
                  </td>
                  <td className="numeric py-1.5 pr-4 text-right text-ink">
                    {formatCount(row.preOwnedRecords)}
                  </td>
                  <td className="numeric py-1.5 text-right text-ink">
                    {formatCount(row.newRecords + row.preOwnedRecords)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
