/**
 * The Executive Overview's accounting integrity signal.
 *
 * WHAT THIS IS, AND WHAT IT IS EMPHATICALLY NOT
 * ---------------------------------------------
 * It is one question answered at one date: does the stock schedule agree with the
 * general ledger, and where it does not, by how much and in which direction. It is not
 * the accounting page. There is no trial balance here, no journal entry, no posting
 * workflow and no per-unit book value — `/dashboard/accounting` owns all of that, does
 * not exist yet, and this section links to nothing that would 404.
 *
 * A VARIANCE IS A FINDING, NOT A FAILURE
 * --------------------------------------
 * The export's own exception text is unambiguous: "BOTH SIDES ARE VALID DATA. Positive
 * means the control account carries more than the stock schedule supports; negative
 * means the schedule carries more than the account. This is a reconciliation finding to
 * investigate, not a broken record." So nothing here is coloured, nothing is called an
 * error, and the direction is published as the words `accounting.ts` supplies rather
 * than as a sign a reader has to interpret.
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
 * Server component.
 */
import { Text } from '@/components/ui/typography'
import type { ReconciliationSignal } from '@/lib/dashboard/executive'
import { exactToString } from '@/lib/dashboard/decimal'
import { formatIsoDate } from '@/lib/dashboard/format'

import { ReconciliationScale, type ScaleAccount } from './visuals'

export function ReconciliationSection({
  signal,
}: {
  readonly signal: ReconciliationSignal
}) {
  const { summary, accounts } = signal

  if (summary.comparisonDate === null || accounts.length === 0) {
    return (
      <Text size="sm" tone="muted" className="max-w-prose">
        No inventory reconciliation falls inside the selected period and store scope. The
        comparison is published at month end, so a period containing no month end has no
        position to report. That is an absence of a measurement date, not a reconciliation
        that failed.
      </Text>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ReconciliationScale
          title="Stock schedule against the general ledger"
          caption={`At the ${formatIsoDate(summary.comparisonDate)} comparison, the last month end inside the selected period. Balances are positions at a date: they add across stores and control accounts on one date and never across dates.`}
          accounts={accounts.map((row): ScaleAccount => ({
            key: `${row.dealershipId}-${row.glAccountNumber}`,
            label: `${row.glAccountName} · ${row.glAccountNumber}`,
            variance: row.varianceAmount,
            display:
              row.varianceAmount === null
                ? 'No variance: one side absent'
                : formatSignedCurrency(exactToString(row.varianceAmount)),
            state: row.comparisonState,
            isComparable: row.isComparable,
          }))}
          totalDisplay={formatSignedCurrency(exactToString(summary.signedVariance))}
          directionText={signal.directionText}
          excludedCount={summary.missingGlPositions + summary.missingSubledgerPositions}
        />

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 self-start">
          <Fact term="Comparable positions" value={String(summary.comparablePositions)} />
          <Fact term="Reconciled" value={String(summary.reconciledPositions)} />
          <Fact term="Carrying a variance" value={String(summary.variancePositions)} />
          <Fact
            term="One-sided"
            value={String(summary.missingGlPositions + summary.missingSubledgerPositions)}
          />
          <Fact
            term="Exceptions in period"
            value={String(signal.exceptionCount)}
            note="Raised by the exception view over this scope. A different vocabulary over a different population from the comparison states beside it; the two are never added together."
          />
        </dl>
      </div>

      <Text size="xs" tone="faint" className="max-w-prose">
        {signal.scenarioNote}
      </Text>
    </div>
  )
}

/**
 * A signed dollar figure, with the sign in front of the symbol.
 *
 * Not `formatCurrencyExact`: that formatter renders a magnitude with the sign placed for
 * a difference line, and a reconciliation variance is neither a difference nor a
 * magnitude — it is a signed position, and losing the sign would lose the entire meaning.
 * The string handed in came from `exactToString`, so no number was involved.
 */
function formatSignedCurrency(exact: string): string {
  const negative = exact.startsWith('-')
  const digits = negative ? exact.slice(1) : exact
  const [whole = '0', fraction = '00'] = digits.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : '+'}$${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`
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
