/**
 * The Executive Overview's accounting integrity signal.
 *
 * WHAT THIS IS, AND WHAT IT IS EMPHATICALLY NOT
 * ---------------------------------------------
 * It is one question answered at one date: does the stock schedule agree with the
 * general ledger, and where it does not, by how much and in which direction. It is not
 * the accounting page. There is no trial balance here, no journal entry, no posting
 * workflow and no per-unit book value. `/dashboard/accounting` owns all of that, and the
 * link at the foot of this section is the drill-through to it.
 *
 * A VARIANCE IS A FINDING, NOT A FAILURE
 * --------------------------------------
 * The export's own exception text is unambiguous: "BOTH SIDES ARE VALID DATA. Positive
 * means the control account carries more than the stock schedule supports; negative
 * means the schedule carries more than the account. This is a reconciliation finding to
 * investigate, not a broken record." So nothing here is coloured, nothing is called an
 * error, and there is no tone, no traffic light and no status word: a governed threshold
 * for "how much variance is too much" does not exist in this project, and inventing one
 * on the Executive page is how a number acquires a verdict it cannot support.
 *
 * THE DIRECTION IS TEXT, NOT A GLYPH OR A COLOUR. "+$384.60" alone does not say which
 * side carries more, and a reader who cannot see colour gets nothing from a red number.
 * The direction is published as the words `accounting.ts` supplies, beside the figure,
 * every time.
 *
 * THE MISSING SIDES ARE NEVER FOLDED INTO THE MONEY. A position with one side absent has
 * no variance at all, so it is plotted nowhere and added to nothing. It is counted
 * separately and labelled, because "two positions could not be compared" and "the books
 * are off by two dollars" are different facts and only one of them is about money.
 *
 * THE SCENARIO NOTE IS NOT SMALL PRINT
 * ------------------------------------
 * Both sides of this comparison are generated from one governed synthetic model, and the
 * development dataset contains deliberately planted variance scenarios so that all four
 * comparison states render. A reader who took these figures as evidence of two
 * independent systems agreeing would have taken away the opposite of what they show, so
 * `CONTROLLED_SCENARIO_NOTE` is rendered in full and comes from the constant both
 * accounting surfaces share.
 *
 * EVERY VALUE ARRIVES ALREADY RENDERED. No component in this console may touch an exact
 * decimal - `dashboard-boundaries.test.ts` asserts it - so the sign, the grouping and the
 * direction sentence are all decided in `lib/dashboard/executive.ts` and this file only
 * places them. The one `Exact` that crosses is `variance`, and it crosses for geometry
 * alone: `ReconciliationScale` turns it into a marker offset and prints the string beside
 * it.
 *
 * Server component.
 */
import Link from 'next/link'

import { Text } from '@/components/ui/typography'
import type { ReconciliationSignalView } from '@/lib/dashboard/executive'
import { ROUTES } from '@/lib/site'

import { ReconciliationScale } from './visuals'

export function ReconciliationSection({
  signal,
}: {
  readonly signal: ReconciliationSignalView
}) {
  if (signal.comparisonDate === null || signal.accounts.length === 0) {
    return (
      <Text size="sm" tone="muted" className="max-w-prose">
        No inventory reconciliation falls inside the selected period and store scope. The
        comparison is published at month end, so a period containing no month end has no
        position to report. That is an absence of a measurement date, not a reconciliation
        that failed.{' '}
        <Link className="underline" href={ROUTES.dashboardAccounting.href}>
          Open accounting integrity
        </Link>
        .
      </Text>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ReconciliationScale
          title="Stock schedule against the general ledger"
          caption={`At the ${signal.asOfLabel} comparison, the last month end inside the selected period. Balances are positions at a date: they add across stores and control accounts on one date and never across dates.`}
          accounts={signal.accounts}
          totalDisplay={signal.signedVarianceLabel ?? 'Not comparable'}
          directionText={signal.directionSentence}
          excludedCount={signal.notComparablePositions}
        />

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 self-start">
          <Fact term="Comparable positions" value={String(signal.comparablePositions)} />
          <Fact term="Reconciled" value={String(signal.reconciledPositions)} />
          <Fact term="Carrying a variance" value={String(signal.variancePositions)} />
          <Fact term="One-sided" value={String(signal.notComparablePositions)} />
          <Fact
            term="Exceptions in scope"
            value={String(signal.exceptionCount)}
            note="Raised by the governed exception view over the stores in scope, each on its own business date rather than on the comparison date. A different vocabulary over a different population from the comparison states beside it; the two are never added together, and this is the same count the accounting page lists."
          />
        </dl>
      </div>

      {/* The scenario note is a CAVEAT and stays visible: a reader who does not know
          some of these variances were planted to prove the control surface will read
          them as discovered errors in a dealership. What left is the sentence
          describing what the destination contains. */}
      <Text size="xs" tone="faint" className="max-w-prose">
        {signal.scenarioNote}
      </Text>
      <Text size="xs" tone="faint">
        <Link className="underline" href={ROUTES.dashboardAccounting.href}>
          Open accounting integrity, account by account
        </Link>
      </Text>
    </div>
  )
}

function Fact({
  term,
  value,
  note,
}: {
  readonly term: string
  readonly value: string
  readonly note?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="font-mono text-2xs tracking-wide text-ink-muted uppercase">
        {term}
      </dt>
      <dd className="numeric text-xl font-semibold text-ink">{value}</dd>
      {note === undefined ? null : (
        <dd className="text-2xs leading-normal text-ink-faint">{note}</dd>
      )}
    </div>
  )
}
