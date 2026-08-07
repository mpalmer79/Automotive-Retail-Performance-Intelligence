/**
 * The store scoreboard.
 *
 * WHY "NOT APPLICABLE" IS THE MOST IMPORTANT CELL ON THIS TABLE
 * ------------------------------------------------------------
 * Granite Pre-Owned Center of Merrimack has no franchise. It cannot be allocated a
 * new vehicle, it does not stock one, and it has never sold one. A scoreboard that
 * prints `0` in its new-units column has ranked a store last for not being in a
 * business it was never in — and every reader who scans the column will read it as
 * a performance figure, because that is what a number in a performance table is.
 * The cell reads "Not applicable", the reason is one tap away, and
 * `dashboard-executive.test.tsx` asserts it specifically.
 *
 * TWO PRESENTATIONS, ONE SET OF VALUES
 * ------------------------------------
 * Ten columns of numbers do not fit a phone, and the inventory table already taught
 * this repository what happens when a wide table is left to scroll inside its own
 * container: at 320px, eight of ten columns were outside the viewport with nothing
 * to say they existed. So below 1280px this is a stack of store cards carrying
 * EVERY column, and at and above it the semantic table. The two are `hidden` at
 * each other's widths, which is `display: none` and therefore removes the inactive
 * one from the accessibility tree — assistive technology is never offered both
 * readings of the same row.
 *
 * NO RANKING, NO HIGHLIGHT, NO ARROW
 * ----------------------------------
 * Rows are in business-code order. Nothing is coloured "best". The three stores run
 * three different operating models — a volume franchise, an all-weather franchise
 * and an independent pre-owned centre — and a league table over them would be a
 * finding, which Gate 2 does not permit this console to publish.
 *
 * Server component.
 */
import { Card } from '@/components/ui/card-static'
import { Text } from '@/components/ui/typography'
import type { ScoreboardColumn, ScoreboardRow } from '@/lib/dashboard/executive'
import { cx } from '@/lib/utils'

import { MetricValue, unitLabel, valueCarriesUnit } from './metric'

const HEAD =
  'px-3 py-2.5 font-mono text-2xs font-medium tracking-wide text-ink-muted uppercase align-bottom'
const CELL = 'px-3 py-2.5 align-middle'

export function StoreScoreboard({
  rows,
  columns,
  caption,
}: {
  rows: readonly ScoreboardRow[]
  columns: readonly ScoreboardColumn[]
  /** Names the period and scope. Used as the table caption and the region name. */
  caption: string
}) {
  return (
    <>
      <TableView rows={rows} columns={columns} caption={caption} />
      <CardView rows={rows} caption={caption} />
      <Notes columns={columns} />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Table                                                                       */
/* -------------------------------------------------------------------------- */

function TableView({
  rows,
  columns,
  caption,
}: {
  rows: readonly ScoreboardRow[]
  columns: readonly ScoreboardColumn[]
  caption: string
}) {
  return (
    /*
     * `tabIndex` and a name on the scroll container: a region that scrolls but
     * cannot take focus is unreachable by keyboard, because its contents are text
     * rather than controls. axe-core reports it as a serious WCAG 2.1.1 violation,
     * and it did, on three store pages, before the inventory table grew this pair.
     */
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="hidden overflow-auto overscroll-x-contain rounded-xl border border-line bg-canvas xl:block"
    >
      <table className="w-full min-w-[60rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-surface-sunken shadow-[0_1px_0_0_var(--color-line)]">
            <th scope="col" className={cx(HEAD, 'pl-4')}>
              Store
            </th>
            {columns.map((column) => (
              <th key={column.id} scope="col" className={cx(HEAD, 'text-right')}>
                <span className="block">{column.label}</span>
                {valueCarriesUnit(column.selector) ? null : (
                  <span className="block font-normal text-ink-faint normal-case">
                    {unitLabel(column.selector)}
                  </span>
                )}
                {column.kpiId === null ? null : (
                  <span className="block font-normal text-ink-faint">{column.kpiId}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.store.id}
              className="border-b border-line-subtle last:border-0 hover:bg-surface-hover"
            >
              <th scope="row" className={cx(CELL, 'pl-4 text-left font-medium text-ink')}>
                <span className="block">{row.store.shortName}</span>
                <span className="block text-2xs font-normal text-ink-faint">
                  {row.store.storeType}
                </span>
              </th>
              {row.cells.map((cell) => (
                <td key={cell.column.id} className={cx(CELL, 'text-right')}>
                  <MetricValue selector={cell.column.selector} result={cell.result} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                       */
/* -------------------------------------------------------------------------- */

function CardView({
  rows,
  caption,
}: {
  rows: readonly ScoreboardRow[]
  caption: string
}) {
  return (
    <ul aria-label={caption} className="flex flex-col gap-3 xl:hidden">
      {rows.map((row) => (
        <li key={row.store.id}>
          <Card as="article" padding="sm" className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-base font-semibold text-ink">{row.store.shortName}</h3>
              <Text size="xs" tone="faint">
                {row.store.storeType} · {row.store.locationLabel}
              </Text>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {row.cells.map((cell) => (
                <div key={cell.column.id} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="font-mono text-2xs tracking-wide text-ink-muted uppercase">
                    {cell.column.label}
                  </dt>
                  <dd>
                    <MetricValue selector={cell.column.selector} result={cell.result} />
                    <span className="block text-2xs text-ink-faint">
                      {cell.column.kpiId ?? unitLabel(cell.column.selector)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */
/* Column notes                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The qualifications the columns need, once, under the table.
 *
 * Repeating them in every cell would double the table's height; leaving them out
 * would let "Lead-to-sale" read as a period figure when it is a cohort figure, and
 * "Average response" read as the median a reader was expecting.
 */
function Notes({ columns }: { columns: readonly ScoreboardColumn[] }) {
  const noted = columns.filter((column) => column.note !== undefined)
  if (noted.length === 0) return null
  return (
    <ul className="flex flex-col gap-1.5">
      {noted.map((column) => (
        <li key={column.id}>
          <Text size="xs" tone="muted">
            <span className="font-medium text-ink-secondary">{column.label}.</span>{' '}
            {column.note}
          </Text>
        </li>
      ))}
    </ul>
  )
}
