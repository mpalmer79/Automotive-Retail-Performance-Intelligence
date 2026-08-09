import Link from 'next/link'

/**
 * The Executive accounting signal: one reconciliation figure, and what it means.
 *
 * WHY IT TAKES PRE-FORMATTED STRINGS
 * ----------------------------------
 * Every value arrives already rendered. No component in this console may touch an exact
 * decimal — `dashboard-boundaries.test.ts` asserts it — so the sign, the grouping and the
 * direction sentence are all decided in `lib/dashboard/executive.ts` and this file only
 * places them.
 *
 * WHAT THE CARD IS CAREFUL NOT TO SAY
 * -----------------------------------
 * A variance is a position to investigate. It is not an error, not a failure and not an
 * audit finding, so there is no tone, no traffic light and no status word here: a governed
 * threshold for "how much variance is too much" does not exist in this project, and inventing
 * one on the Executive page is exactly how a number acquires a verdict it cannot support.
 *
 * THE DIRECTION IS TEXT, NOT A GLYPH OR A COLOUR. "+$384.60" alone does not say which side
 * carries more, and a reader who cannot see colour gets nothing from a red number. The
 * sentence beneath the figure names the direction every time.
 *
 * THE MISSING SIDES ARE NEVER FOLDED INTO THE MONEY. A position with one side absent has no
 * variance at all, so it cannot be added to a dollar figure. It is counted separately and
 * labelled, because "two positions could not be compared" and "the books are off by two
 * dollars" are different facts and only one of them is about money.
 */
export interface ReconciliationSignalView {
  /** `2025-12-31`, already formatted for display. */
  readonly asOfLabel: string | null
  /** `+$384.60`, sign included, or `null` when nothing is comparable. */
  readonly signedVarianceLabel: string | null
  /** "the general ledger carries more than the subledger". */
  readonly directionSentence: string
  readonly comparablePositions: number
  readonly reconciledPositions: number
  readonly variancePositions: number
  /** Missing GL plus missing subledger. Deliberately not part of any money figure. */
  readonly notComparablePositions: number
}

export function ReconciliationSignal({
  signal,
  href,
}: {
  signal: ReconciliationSignalView
  href: string
}) {
  if (signal.asOfLabel === null) {
    return (
      <p className="text-sm text-ink-muted">
        No comparison date falls inside the selected period.{' '}
        <Link className="underline" href={href}>
          Open accounting integrity
        </Link>
        .
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1 rounded-card border border-line p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            Reconciliation variance
          </dt>
          <dd className="font-mono text-lg text-ink">
            {signal.signedVarianceLabel ?? 'Not comparable'}
          </dd>
          <dd className="text-xs text-ink-faint">{signal.directionSentence}</dd>
        </div>
        <div className="flex flex-col gap-1 rounded-card border border-line p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            Positions agreeing
          </dt>
          <dd className="font-mono text-lg text-ink">
            {signal.reconciledPositions} of {signal.comparablePositions}
          </dd>
          <dd className="text-xs text-ink-faint">Comparable positions only</dd>
        </div>
        <div className="flex flex-col gap-1 rounded-card border border-line p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            Positions with a variance
          </dt>
          <dd className="font-mono text-lg text-ink">{signal.variancePositions}</dd>
          <dd className="text-xs text-ink-faint">To investigate, not an error</dd>
        </div>
        <div className="flex flex-col gap-1 rounded-card border border-line p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            Positions not comparable
          </dt>
          <dd className="font-mono text-lg text-ink">{signal.notComparablePositions}</dd>
          <dd className="text-xs text-ink-faint">One side missing; no variance exists</dd>
        </div>
      </dl>

      <p className="text-sm text-ink-muted">
        General ledger minus subledger, at {signal.asOfLabel}. Balances are positions at a
        date and are never summed across dates. Control accounts are synthetic and both
        sides are generated from one governed model, so this is not agreement between two
        independent systems.{' '}
        <Link className="underline" href={href}>
          Open accounting integrity
        </Link>
        .
      </p>
    </div>
  )
}
