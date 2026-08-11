/**
 * The Deal Explorer's summary strip: what the filtered population IS, before it is listed.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured before `UX.2B` (`docs/reviews/UX-2B-BASELINE.md` §7): the size of the filtered
 * population was a chip in the page header — `650 deals` — and what that population was worth
 * was not stated anywhere. A desk manager who narrows to one store and one month and then
 * reads twenty-five rows out of six hundred has no way to tell whether the filter they applied
 * is the one they meant.
 *
 * WHAT IT IS NOT. `UX.2B` §15 asks for investigation context and forbids duplicating the Sales
 * & Gross dashboard here. There is no rate, no comparison, no target, no trend and no chart:
 * six counts and sums over the rows the table is paging through, and a link to the surface
 * that owns the per-unit measures.
 *
 * THE POPULATION IS NAMED ON THE STRIP. Deals counts every transaction the filter matched;
 * the four money figures are over the RETAIL rows only, because a wholesale disposal is a real
 * transaction that belongs in the table and does not belong in a retail gross total. Both
 * numbers are shown, so the difference between them is visible rather than implied.
 *
 * A server component. Every figure arrives formatted from `lib/dashboard/deals.ts`.
 */
import type { DealsView } from '@/lib/dashboard/deals'
import { formatCount } from '@/lib/utils'

/** One figure on the strip. `null` renders the words, never a zero. */
interface SummaryCell {
  readonly id: string
  readonly label: string
  readonly value: string | null
  readonly note?: string
  readonly rank: 'lead' | 'supporting'
}

export function DealSummaryStrip({
  view,
  dealsLabel,
}: {
  readonly view: DealsView
  /** What one row is, in the reader's words: "deals matching this filter". */
  readonly dealsLabel: string
}) {
  const cells: readonly SummaryCell[] = [
    {
      id: 'deals',
      label: 'Deals',
      value: formatCount(view.totalCount),
      note: dealsLabel,
      rank: 'lead',
    },
    {
      id: 'retail-units',
      label: 'Retail units',
      value: formatCount(view.retailCount),
      note:
        view.totalCount === view.retailCount
          ? 'Every matched transaction is retail'
          : `${formatCount(view.totalCount - view.retailCount)} matched transactions are not retail`,
      rank: 'lead',
    },
    {
      id: 'total-gross',
      label: 'Total gross',
      value: view.totalGrossDisplay,
      note: 'Retail rows only',
      rank: 'lead',
    },
    {
      id: 'front-gross',
      label: 'Front gross',
      value: view.frontGrossDisplay,
      rank: 'supporting',
    },
    {
      id: 'back-gross',
      label: 'Back gross',
      value: view.backGrossDisplay,
      rank: 'supporting',
    },
    {
      id: 'negative-front',
      label: 'Closed at a front loss',
      value: formatCount(view.negativeFrontCount),
      rank: 'supporting',
    },
  ]

  const lead = cells.filter((cell) => cell.rank === 'lead')
  const supporting = cells.filter((cell) => cell.rank === 'supporting')

  return (
    <div className="flex flex-col gap-2">
      {/*
        THREE ACROSS AT EVERY WIDTH, INCLUDING 320px. `UX.2B` §50 wants the transactions as
        close to the top of a phone screen as the shared control band allows, and three
        full-width cells stacked would spend a third of an 844 px screen restating the
        filter. The lead figures are short — two counts and a currency total — so three
        across stays legible where three stacked would not fit at all.
      */}
      <dl className="grid grid-cols-3 gap-2">
        {lead.map((cell) => (
          <SummaryFigure key={cell.id} cell={cell} />
        ))}
      </dl>
      {/*
        THE SUPPORTING FIGURES ARE A LINE, NOT THREE MORE CARDS. They qualify the total
        above rather than answering a question of their own, and six cards of equal weight
        would say six things matter equally — the mistake the nine-tile grid on Sales &
        Gross made. Still a definition list, so each label stays attached to its value in
        the accessibility tree.
      */}
      <dl className="flex flex-wrap gap-x-5 gap-y-1.5">
        {supporting.map((cell) => (
          <div key={cell.id} className="flex items-baseline gap-1.5">
            <dt className="text-xs text-ink-secondary">{cell.label}</dt>
            <dd
              className={
                cell.value === null
                  ? 'text-xs text-ink-muted'
                  : 'numeric text-sm font-semibold text-ink'
              }
              data-deal-summary={cell.id}
            >
              {cell.value ?? 'No retail rows'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SummaryFigure({ cell }: { readonly cell: SummaryCell }) {
  const resolved = cell.value !== null
  return (
    <div
      data-deal-summary={cell.id}
      className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line-subtle bg-surface p-2.5 sm:p-3"
    >
      <dt className="text-xs leading-snug text-ink-secondary">{cell.label}</dt>
      <dd
        className={
          resolved
            ? `numeric font-semibold text-ink ${cell.rank === 'lead' ? 'text-lg sm:text-2xl' : 'text-sm sm:text-base'}`
            : 'text-sm text-ink-muted'
        }
      >
        {/* A population with no retail row has no retail gross. That is a stated absence
            and not a total of zero, which is the same rule every other surface applies. */}
        {cell.value ?? 'No retail rows in this selection'}
      </dd>
      {/* THE NOTE IS NEVER HIDDEN RESPONSIVELY. "Retail rows only" is what keeps a reader
          from adding a wholesale disposal into a retail gross total, and `hidden` removes an
          element from the accessibility tree as well as from the page. A caveat that
          disappears on a phone is a caveat the page is hoping nobody reads. */}
      {cell.note === undefined ? null : (
        <dd className="mt-auto pt-0.5 text-2xs leading-normal text-ink-faint">
          {cell.note}
        </dd>
      )}
    </div>
  )
}
