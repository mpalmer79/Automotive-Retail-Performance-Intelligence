/**
 * The operating row: what shape the period has, and which store is different.
 *
 * WHY THESE TWO SIT TOGETHER
 * --------------------------
 * They are the two halves of one question. The trend answers "what has been happening",
 * the comparison answers "to whom", and a reader who has both can form the sentence a
 * Monday meeting actually opens with. Separating them into two full-width sections — as
 * the first console layout did with every block on the page — made the reader hold the
 * first answer in their head while scrolling to the second.
 *
 * BOTH ARE DRAWN FROM THE SAME TRAILING WINDOW AND THE SAME SELECTORS AS THE CARDS
 * --------------------------------------------------------------------------------
 * `executive.ts` resolves the window once and every shape on the page is drawn over it,
 * so a column here and a column on a KPI card above cannot describe different months.
 * The values are the same governed selectors the scoreboard uses, evaluated at one
 * store's scope; nothing on this row is a second calculation of anything.
 *
 * Server components. No client JavaScript.
 */
import { Text } from '@/components/ui/typography'
import type {
  ExecutiveOverview,
  StoreComparison as StoreComparisonModel,
  TrendBucket,
} from '@/lib/dashboard/executive'
import { formatCountExact, formatCurrencyExact } from '@/lib/dashboard/format'

import { formatMetric, stateLabel } from './metric'
import {
  StoreComparisonBars,
  TrendChart,
  type ComparisonBarRow,
  type TrendPoint,
} from './visuals'

/* -------------------------------------------------------------------------- */
/* The operating trend                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Retail volume and total gross over the trailing months.
 *
 * MONTHLY, ALWAYS, AND ANCHORED ON THE SELECTION. The Sales and Gross page chooses a
 * granularity from the length of the selected period because its subject IS the shape
 * inside that period. This is an executive summary: the question is where the selected
 * month sits against the months before it, and a daily strip of thirty columns answers a
 * different one. The window moves with the filter — selecting September genuinely
 * shortens it, because the export begins in July — so the picture is never the same
 * regardless of what the reader asked for.
 *
 * TWO SERIES, TWO CHARTS. Volume and gross are in different units and overlaying them
 * would require a second axis, which is the device that makes two unrelated shapes look
 * correlated.
 */
export function OperatingTrend({ trend }: { readonly trend: readonly TrendBucket[] }) {
  const caption = `One column per calendar month, ending with the selected period. ${String(trend.length)} month${trend.length === 1 ? '' : 's'} of the exported reporting window are in scope.`

  return (
    <div className="flex flex-col gap-8">
      <TrendChart
        title="Retail units"
        caption={caption}
        measure="Retail units"
        points={trend.map((bucket): TrendPoint => ({
          key: bucket.key,
          label: bucket.label,
          value: bucket.retailUnits.kind === 'value' ? bucket.retailUnits.value : null,
          display:
            bucket.retailUnits.kind === 'value'
              ? formatCountExact(bucket.retailUnits.value)
              : (stateLabel(bucket.retailUnits) ?? 'No value'),
        }))}
        periodHeading="Month"
        valueHeading="Units"
      />
      <TrendChart
        title="Total gross"
        caption={caption}
        measure="Total gross"
        points={trend.map((bucket): TrendPoint => ({
          key: bucket.key,
          label: bucket.label,
          value: bucket.totalGross.kind === 'value' ? bucket.totalGross.value : null,
          display:
            bucket.totalGross.kind === 'value'
              ? formatCurrencyExact(bucket.totalGross.value)
              : (stateLabel(bucket.totalGross) ?? 'No value'),
        }))}
        periodHeading="Month"
        valueHeading="Total gross"
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The store comparison                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Two governed measures across the stores in scope.
 *
 * ONE STORE IS NOT A COMPARISON, AND THE SECTION SAYS SO. When the filter narrows to a
 * single store the bars still render — the figure is real — but the notice names the
 * missing context and the reader can widen the scope from the active-filter chips above.
 * Rendering one lone full-width bar with no comment would present a scale of one as a
 * result.
 */
export function StoreComparisonSection({
  overview,
}: {
  readonly overview: ExecutiveOverview
}) {
  const single = overview.scope.stores.length < 2

  return (
    <div className="flex flex-col gap-8">
      {overview.comparisons.map((comparison) => (
        <StoreComparisonBars
          key={comparison.id}
          title={comparison.label}
          kpiId={comparison.selector.kpiId}
          rows={rowsOf(comparison)}
          caption={
            comparison.id === 'retailUnits'
              ? 'How much each store sold, over the selected period.'
              : 'How much gross each store made per retail unit sold. A smaller store is not a worse one, and this is the measure that separates the two.'
          }
          singleStoreNotice={
            single
              ? 'One store is in scope, so there is nothing to compare it against. Remove the store filter above to see all three.'
              : undefined
          }
        />
      ))}
      <Text size="xs" tone="faint" className="max-w-prose">
        Stores are in business-code order and nothing is marked best. The three run
        different operating models: a volume franchise, an all-weather franchise and an
        independent pre-owned centre. A league table over them would be a finding rather
        than a figure. The other eight governed columns are in the scoreboard below.
      </Text>
    </div>
  )
}

function rowsOf(comparison: StoreComparisonModel): readonly ComparisonBarRow[] {
  return comparison.rows.map((row) => ({
    key: row.store.id,
    storeShortName: row.store.shortName,
    storeType: row.store.storeType,
    result: row.result,
    display:
      formatMetric(comparison.selector, row.result) ??
      stateLabel(row.result) ??
      'No value',
  }))
}
