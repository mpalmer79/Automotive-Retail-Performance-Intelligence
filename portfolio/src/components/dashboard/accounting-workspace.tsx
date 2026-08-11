/**
 * The Accounting workspace: the position rail, the balance comparison, and the exceptions.
 *
 * WHAT THIS REPLACED, MEASURED
 * ----------------------------
 * `docs/reviews/UX-2C-BASELINE.md` §1–§3: `/dashboard/accounting` carried **zero framed figures
 * at any viewport**, down a 3,290 px document of four regions. The three figures a controller
 * opens the page for — the schedule, the control account and the difference between them —
 * arrived as the FOURTH thing on the page, after a subtitle, a filter bar, a disclosure, an
 * eyebrow, an `h2` and a lede, and they arrived as four equal cells in which the signed
 * variance was a peer of "positions not comparable".
 *
 * Two balances and their signed difference is the most naturally drawable thing on any of the
 * four `UX.2C` routes and it was three numbers in three boxes.
 *
 * THE VARIANCE IS SIGNED AND THE SIGN IS NOT A VERDICT (`UX.2C` §29)
 * ------------------------------------------------------------------
 * Nothing here is green because a number is positive or red because it is negative. The
 * export's own exception text is unambiguous — *"BOTH SIDES ARE VALID DATA… This is a
 * reconciliation finding to investigate, not a broken record"* — so a positive/negative colour
 * pair would publish a judgement this console is not authorized to make, and would publish it
 * as geometry, where the words cannot correct it. The sign is carried three ways instead: by
 * which balance bar is longer, by the printed amount, and by the direction sentence
 * `varianceDirection` supplies.
 *
 * WHERE ATTENTION COLOUR IS USED, AND WHY ONLY THERE (`UX.2C` §30)
 * ----------------------------------------------------------------
 * The two MISSING-SIDE states take the attention treatment, and no other state does. That is
 * not a judgement about the size of a number — it is a STRUCTURAL condition: a position with
 * one side absent has no variance at all, cannot be compared, and is excluded from both totals.
 * `Variance` does not take it, because a non-zero variance is a finding to investigate and this
 * project governs no threshold above which one becomes a failure. `Reconciled` does not take a
 * success colour either, for the same reason in reverse.
 *
 * A MISSING SIDE IS NEVER DRAWN AS ZERO. It draws no bar and prints "No GL balance" or "No
 * subledger balance". A zero-length bar for an absent balance would state that the balance is
 * zero, and a GL control at $0.00 is a far more alarming fact than one that was not published.
 *
 * NO SURROGATE KEYS AND NO INTERNAL IDENTIFIERS (`UX.2C` §31). Every identity a reader sees is
 * a business code: the dealership code, the GL account number and its name, the exception code.
 *
 * NO CLIENT JAVASCRIPT. Server components throughout.
 */
import type { ReactNode } from 'react'

import { Card } from '@/components/ui/card-static'
import type { ComparisonRow, ReconciliationSummary } from '@/lib/dashboard/accounting'
import { exactToApproxNumber, type Exact } from '@/lib/dashboard/decimal'
import {
  formatCurrencyDifference,
  formatCurrencyExact,
  formatIsoDate,
} from '@/lib/dashboard/format'
import { cx } from '@/lib/utils'

import { ChartFrame, TableDisclosure } from './visuals'

/* -------------------------------------------------------------------------- */
/* The position rail                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The three a controller reads first, and the four that qualify them.
 *
 * WHY THESE THREE. `UX.2C` §28 names the subledger balance, the GL balance and the signed
 * variance as primary and warns against over-carding the page. They are the whole question the
 * route exists to answer. Everything else — the date the position was taken, how many positions
 * could not be compared, how many exceptions are open, how many units stand behind the schedule
 * — qualifies one of the three rather than competing with it.
 *
 * THE COMPARISON DATE IS A SECONDARY CARD AND NOT A HEADING. The balances are positions at ONE
 * date, never a sum across dates, and a reader who missed that would read a month-end snapshot
 * as a period total. It sits on the rail rather than in the page context line so it cannot
 * scroll away from the figures it governs.
 */
export function PositionRail({
  summary,
  exceptionCount,
  stockUnits,
}: {
  readonly summary: ReconciliationSummary
  readonly exceptionCount: number
  /** Units standing behind the schedule at this date, or `null` where none is published. */
  readonly stockUnits: number | null
}) {
  const notComparable = summary.missingGlPositions + summary.missingSubledgerPositions

  const lead = [
    {
      id: 'subledger',
      label: 'Inventory subledger',
      value: formatCurrencyExact(summary.subledgerTotal),
      note: `${String(summary.comparablePositions)} comparable position${summary.comparablePositions === 1 ? '' : 's'}`,
    },
    {
      id: 'gl',
      label: 'GL control balance',
      value: formatCurrencyExact(summary.glTotal),
      note: 'Synthetic control accounts',
    },
    {
      id: 'variance',
      label: 'Signed variance',
      value: formatCurrencyDifference(summary.signedVariance, 2),
      note: 'GL minus subledger',
    },
  ]

  const context = [
    {
      id: 'date',
      label: 'Position at',
      value:
        summary.comparisonDate === null
          ? 'No date in period'
          : formatIsoDate(summary.comparisonDate),
      note: 'One date, never summed across dates',
    },
    {
      id: 'not-comparable',
      label: 'Not comparable',
      value: String(notComparable),
      note: `${String(summary.missingGlPositions)} missing GL, ${String(summary.missingSubledgerPositions)} missing subledger`,
    },
    {
      id: 'exceptions',
      label: 'Open exceptions',
      value: String(exceptionCount),
      note: 'Each on its own exception date',
    },
    {
      id: 'units',
      label: 'Units on the schedule',
      value: stockUnits === null ? 'Not published' : String(stockUnits),
      note: 'The physical count the subledger stands for',
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-1 gap-2 @md:grid-cols-3">
        {lead.map((entry) => (
          <RailCard key={entry.id} entry={entry} rank="lead" />
        ))}
      </ul>
      <ul className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        {context.map((entry) => (
          <RailCard key={entry.id} entry={entry} rank="supporting" />
        ))}
      </ul>
    </div>
  )
}

function RailCard({
  entry,
  rank,
}: {
  readonly entry: {
    readonly id: string
    readonly label: string
    readonly value: string
    readonly note: string
  }
  readonly rank: 'lead' | 'supporting'
}) {
  return (
    <Card
      as="li"
      padding="none"
      data-kpi-card={entry.id}
      data-kpi-rank={rank}
      className={cx(
        'flex min-w-0 flex-col gap-1',
        rank === 'lead' ? 'p-3.5' : 'gap-0.5 p-2.5'
      )}
    >
      <h3 className="text-xs leading-snug font-semibold text-ink-secondary">
        {entry.label}
      </h3>
      <span
        className={cx(
          'numeric font-semibold text-ink',
          rank === 'lead' ? 'text-2xl' : 'text-base'
        )}
      >
        {entry.value}
      </span>
      <p className="text-2xs leading-normal text-ink-muted">{entry.note}</p>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* The balance comparison                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The two balances as paired bars against one shared scale, with the difference printed.
 *
 * ONE SCALE FOR BOTH BARS, AND IT HAS TO BE ONE. The whole point of the figure is that the two
 * lengths are nearly equal and the interesting quantity is the sliver between them; scaling
 * each to its own maximum would draw two identical full-width bars whatever the variance was —
 * a chart whose geometry is fixed, which `UX.2C` §55 requires to fail.
 *
 * THE VARIANCE IS DRAWN AS THE DIFFERENCE, not as a third peer bar. It is the length by which
 * the longer bar overhangs the shorter, marked on the same axis, so a reader sees the quantity
 * rather than reading it. Its magnitude against these balances is genuinely tiny, and a figure
 * that made it look large would be flattering the finding.
 *
 * NEITHER SIGN IS COLOURED. Both bars take a categorical identity hue and the overhang takes
 * the neutral mark — the one token in this vocabulary that means "this mark is not a verdict".
 * The direction is words, on the same line as the amount.
 */
export function BalanceComparison({
  summary,
  directionText,
}: {
  readonly summary: ReconciliationSummary
  readonly directionText: string
}) {
  const subledger = exactToApproxNumber(summary.subledgerTotal)
  const gl = exactToApproxNumber(summary.glTotal)
  const largest = Math.max(subledger, gl, 0)

  const width = (value: number): string =>
    largest <= 0 ? '0%' : `${((value / largest) * 100).toFixed(4)}%`

  const bars = [
    {
      key: 'subledger',
      label: 'Inventory subledger',
      value: subledger,
      display: formatCurrencyExact(summary.subledgerTotal),
      mark: 'bg-data-primary',
    },
    {
      key: 'gl',
      label: 'GL control balance',
      value: gl,
      display: formatCurrencyExact(summary.glTotal),
      mark: 'bg-data-secondary',
    },
  ]

  const notComparable = summary.missingGlPositions + summary.missingSubledgerPositions

  return (
    <ChartFrame
      title="Balances at this date"
      caption={
        summary.comparisonDate === null
          ? 'No comparison date falls inside the selected period.'
          : `Comparable positions at ${formatIsoDate(summary.comparisonDate)}, on one shared scale.`
      }
      summary={`Inventory subledger ${formatCurrencyExact(summary.subledgerTotal)} against GL control balance ${formatCurrencyExact(summary.glTotal)} over ${String(summary.comparablePositions)} comparable positions. Signed variance ${formatCurrencyDifference(summary.signedVariance, 2)}: ${directionText}.`}
      summaryMode="sr-only"
      headingLevel={3}
    >
      <ul className="flex flex-col gap-2">
        {bars.map((bar) => (
          <li key={bar.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-ink-secondary">
                {bar.label}
              </span>
              <span className="numeric shrink-0 text-sm font-semibold text-ink">
                {bar.display}
              </span>
            </div>
            <span
              aria-hidden="true"
              className="h-4 w-full overflow-hidden rounded-xs bg-surface-sunken"
              data-balance-bar={bar.key}
              data-width={width(bar.value)}
            >
              <span
                className={cx('block h-full rounded-xs', bar.mark)}
                style={{ width: width(bar.value) }}
              />
            </span>
          </li>
        ))}
      </ul>

      {/*
        THE DIFFERENCE, ON THE SAME AXIS AS THE TWO BARS ABOVE IT. The offset is the shorter
        balance and the run is the overhang, so the mark begins where the bars stop agreeing.
        Neither direction is coloured: `data-neutral` is the token that means this mark carries
        no verdict, and it is the same token whichever way the sign points.
      */}
      <div className="flex flex-col gap-1 border-t border-line-subtle pt-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-xs text-ink-secondary">Signed variance</span>
          <span className="numeric shrink-0 text-sm font-semibold text-ink">
            {formatCurrencyDifference(summary.signedVariance, 2)}
          </span>
        </div>
        <span
          aria-hidden="true"
          className="flex h-2 w-full overflow-hidden rounded-pill bg-surface-sunken"
        >
          <span
            className="block h-full shrink-0"
            style={{ width: width(Math.min(subledger, gl)) }}
          />
          <span
            className="block h-full rounded-pill bg-data-neutral"
            style={{ width: width(Math.abs(gl - subledger)) }}
          />
        </span>
        <p className="text-2xs leading-normal text-ink-muted">
          {`At this position ${directionText}.`} Neither direction is favourable: this
          project governs no threshold above which a variance becomes a failure.
          {notComparable > 0
            ? ` ${String(notComparable)} one-sided position${notComparable === 1 ? '' : 's'} excluded: a balance that does not exist is not a balance of zero.`
            : ''}
        </p>
      </div>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Comparison states                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The four governed comparison states, as a population.
 *
 * THE FOUR ARE THE EXPORT'S OWN CLOSED SET. `COMPARISON_STATES` in `accounting.ts` declares
 * exactly `Reconciled`, `Variance`, `Missing GL balance` and `Missing subledger balance`, and
 * decoding throws on anything else. `UX.2C` §30 forbids inventing a status class the data
 * contract does not carry, and there is nowhere here one could come from.
 *
 * ONLY THE TWO STRUCTURAL STATES TAKE ATTENTION COLOUR. A missing side is a position that
 * cannot be compared at all; a variance is a finding to investigate, and colouring it would be
 * this console asserting a materiality threshold it does not have. Every state prints its own
 * name and its own count, so no meaning rests on colour.
 */
export function ComparisonStates({
  summary,
  rows,
}: {
  readonly summary: ReconciliationSummary
  readonly rows: readonly ComparisonRow[]
}) {
  const states = [
    {
      key: 'Reconciled',
      label: 'Reconciled',
      count: summary.reconciledPositions,
      structural: false,
      note: 'Both sides present, equal',
    },
    {
      key: 'Variance',
      label: 'Variance',
      count: summary.variancePositions,
      structural: false,
      note: 'Both sides present, unequal',
    },
    {
      key: 'Missing GL balance',
      label: 'Missing GL balance',
      count: summary.missingGlPositions,
      structural: true,
      note: 'No control balance, so no variance',
    },
    {
      key: 'Missing subledger balance',
      label: 'Missing subledger balance',
      count: summary.missingSubledgerPositions,
      structural: true,
      note: 'No schedule balance, so no variance',
    },
  ]

  const total = summary.totalPositions
  const width = (count: number): string =>
    total <= 0 ? '0%' : `${((count / total) * 100).toFixed(4)}%`

  return (
    <ChartFrame
      title="Every position, by state"
      caption="The export's own four states, over every position at this date."
      summary={states.map((state) => `${state.label}: ${String(state.count)}`).join('. ')}
      summaryMode="sr-only"
      headingLevel={3}
    >
      <ul className="flex flex-col gap-2">
        {states.map((state) => (
          <li key={state.key} className="flex flex-col gap-1" data-state={state.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-ink-secondary">
                {state.label}
              </span>
              <span className="numeric shrink-0 text-sm font-semibold text-ink">
                {String(state.count)}
              </span>
            </div>
            <span
              aria-hidden="true"
              className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
            >
              <span
                className={cx(
                  'block h-full rounded-pill',
                  state.structural ? 'bg-data-warning/70' : 'bg-data-neutral'
                )}
                style={{ width: width(state.count) }}
              />
            </span>
            <span className="text-2xs leading-normal text-ink-muted">{state.note}</span>
          </li>
        ))}
      </ul>
      <p className="text-2xs leading-normal text-ink-muted">
        {String(total)} position{total === 1 ? '' : 's'} at this date. Only the first two
        contribute to a balance; the marked pair are one-sided and are counted, not added.
        A variance is not marked, because no threshold makes one a failure here.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-muted">
          No comparison rows for this period and store selection.
        </p>
      ) : null}
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Positions                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One row per store and control account, as a table, because that is what a controller checks.
 *
 * NOT DRAWN, DELIBERATELY. `UX.2C` §47 says outright not to remove a table because the
 * increment wants more visualization, and this is the artefact the job is done against: a
 * controller reads exact signed cents against an account number, and no bar substitutes for
 * that. The two figures above it are the summary and the comparison; this is the detail.
 *
 * THE SCROLL REGION IS FOCUSABLE AND NAMED, so a reader without a pointer can reach the
 * right-hand columns — WCAG 2.1.1, the contract `DASH.9` set for every wide table on this
 * console.
 */
export function PositionTable({
  rows,
  comparisonDate,
}: {
  readonly rows: readonly ComparisonRow[]
  readonly comparisonDate: string | null
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No comparison rows for this period and store selection.
      </p>
    )
  }

  return (
    <div
      className="overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label="Reconciliation positions"
    >
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <caption className="sr-only">
          Inventory subledger against GL control balances at{' '}
          {comparisonDate === null ? 'no date' : formatIsoDate(comparisonDate)}
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-xs tracking-wide text-ink-muted uppercase">
            <th scope="col" className="py-2 pr-4">
              Store
            </th>
            <th scope="col" className="py-2 pr-4">
              Control account
            </th>
            <th scope="col" className="py-2 pr-4 text-right">
              Subledger
            </th>
            <th scope="col" className="py-2 pr-4 text-right">
              GL
            </th>
            <th scope="col" className="py-2 pr-4 text-right">
              Variance
            </th>
            <th scope="col" className="py-2 pr-4">
              State
            </th>
            <th scope="col" className="py-2 text-right">
              Units
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.dealershipId}-${row.glAccountNumber}`}
              className="border-b border-line-subtle last:border-0"
              data-position-state={row.comparisonState}
            >
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {row.dealershipId}
              </th>
              <td className="py-2 pr-4">
                {row.glAccountNumber} · {row.glAccountName}
              </td>
              <td className="numeric py-2 pr-4 text-right">
                {row.subledgerBalance === null ? (
                  <span className="text-ink-faint">No subledger balance</span>
                ) : (
                  formatCurrencyExact(row.subledgerBalance)
                )}
              </td>
              <td className="numeric py-2 pr-4 text-right">
                {row.glBalance === null ? (
                  <span className="text-ink-faint">No GL balance</span>
                ) : (
                  formatCurrencyExact(row.glBalance)
                )}
              </td>
              <td className="numeric py-2 pr-4 text-right">
                {row.varianceAmount === null ? (
                  <span className="text-ink-faint">Not comparable</span>
                ) : (
                  formatCurrencyDifference(row.varianceAmount, 2)
                )}
              </td>
              <td className="py-2 pr-4">
                <StateTag state={row.comparisonState} />
              </td>
              <td className="numeric py-2 text-right">{row.stockUnitCount ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The governed state, as a tag whose words carry the meaning and whose tint does not. */
function StateTag({ state }: { readonly state: string }) {
  const structural = state.startsWith('Missing')
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-pill border px-2 py-0.5 text-2xs whitespace-nowrap',
        structural
          ? 'border-data-warning/40 bg-data-warning-wash text-ink'
          : 'border-line-subtle bg-surface text-ink-muted'
      )}
    >
      {state}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Exceptions                                                                  */
/* -------------------------------------------------------------------------- */

/** One exception, as the page renders it. */
export interface ExceptionEntry {
  readonly exceptionId: string
  readonly exceptionCode: string
  readonly dealershipId: string
  readonly exceptionDate: string
  readonly exceptionAmount: Exact | null
  readonly exceptionDetail: string
  readonly href: string | null
}

/**
 * The exception register, as an investigation list.
 *
 * COMPACT, SCANNABLE, AND STILL EVIDENCE. `UX.2C` §31 asks for scanability, store and date
 * context, signed values, drill-through and state identity, without exposing surrogate keys or
 * internal identifiers — so a row leads with the business exception code, carries the store and
 * the exception's own date as chips, prints the signed amount, and links onward where the
 * exception type has a destination.
 *
 * THESE ARE NOT ONE KIND OF FINDING AND ARE NOT TOTALLED. The export publishes several
 * exception types on their own dates and a sum across them would be a number with no meaning.
 *
 * AND THEY ARE NOT DISCOVERED FRAUD. Some of these scenarios are planted on purpose so that all
 * four comparison states render in a synthetic dataset. That is stated where the list is, not
 * in a footnote three screens away, because a reader who took them as findings in a real
 * dealership would have taken away the opposite of what they show.
 */
export function ExceptionRegister({
  entries,
  scenarioNote,
}: {
  readonly entries: readonly ExceptionEntry[]
  readonly scenarioNote: ReactNode
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No accounting exceptions for this store selection. The controls were evaluated and
        found nothing; that is a result, not an absence of checking.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-line-subtle">
        {entries.map((entry) => (
          <li
            key={entry.exceptionId}
            className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0"
            data-exception={entry.exceptionCode}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-xs font-medium text-ink">
                {entry.exceptionCode}
              </span>
              <span className="inline-flex items-center rounded-pill border border-line-subtle bg-surface px-2 py-0.5 text-2xs text-ink-muted">
                {entry.dealershipId}
              </span>
              <span className="inline-flex items-center rounded-pill border border-line-subtle bg-surface px-2 py-0.5 text-2xs text-ink-muted">
                {formatIsoDate(entry.exceptionDate)}
              </span>
              {entry.exceptionAmount === null ? null : (
                <span className="numeric ml-auto shrink-0 text-sm font-semibold text-ink">
                  {formatCurrencyDifference(entry.exceptionAmount, 2)}
                </span>
              )}
            </div>
            <p className="text-xs leading-normal text-ink-muted">
              {entry.exceptionDetail}
            </p>
            {entry.href === null ? (
              <p className="text-2xs text-ink-faint">
                No drill-through available for this exception type
              </p>
            ) : (
              <p className="text-2xs">
                <a
                  className="inline-flex min-h-6 items-center underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                  href={entry.href}
                >
                  Open this position
                </a>
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-2xs leading-normal text-ink-muted">{scenarioNote}</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Period ownership                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Which date owns which row, as a compact table behind a disclosure.
 *
 * IT WAS A REGION AND IT IS A DISCLOSURE. Four definition pairs and a paragraph at the foot of
 * the page — 130 of the route's 422 words — telling a controller something genuinely useful
 * exactly once. `UX.2C` §46 puts detail behind disclosure and keeps visible only what a reader
 * would misread the figure without; the "position at one date, never summed across dates"
 * statement they DO need is on the rail, on the comparison caption and here.
 */
export function PeriodOwnership() {
  const rows = [
    {
      basis: 'Subledger balance',
      owner: 'Accounting snapshot date — a month end',
      note: 'The schedule is a position, and a unit still in stock at two month ends appears at both.',
    },
    {
      basis: 'GL control balance',
      owner: 'Balance date',
      note: 'Compared only against a subledger balance on the same date; an unmatched date is not compared at all.',
    },
    {
      basis: 'Reconciliation',
      owner: 'The matched accounting and balance date',
      note: 'Positions from other dates are not pooled into it.',
    },
    {
      basis: 'Exceptions',
      owner: "The exception's own date",
      note: 'Not restated into the period a reader happens to be looking at.',
    },
  ]

  return (
    <TableDisclosure title="which date owns which row">
      <table className="w-full min-w-[30rem] border-collapse text-sm">
        <caption className="sr-only">
          The date basis each figure on this page is published on.
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-xs tracking-wide text-ink-muted uppercase">
            <th scope="col" className="py-2 pr-3">
              Figure
            </th>
            <th scope="col" className="py-2 pr-3">
              Date basis
            </th>
            <th scope="col" className="py-2">
              What that means
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.basis} className="border-b border-line-subtle last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                {row.basis}
              </th>
              <td className="py-2 pr-3 text-ink-secondary">{row.owner}</td>
              <td className="py-2 text-ink-muted">{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pt-2 text-2xs leading-normal text-ink-muted">
        ARPI records no posting timestamp, so no journal-posting delay is computable and
        none is shown. The only timing figure the accounting domain supports is the
        interval from a unit&rsquo;s acquisition to its first month-end appearance on the
        schedule.
      </p>
    </TableDisclosure>
  )
}
