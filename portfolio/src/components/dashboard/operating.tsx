/**
 * The two anchors of the workspace: what shape the period has, and whose it is.
 *
 * WHY THESE TWO SIT SIDE BY SIDE
 * ------------------------------
 * They are the two halves of one question. The trend answers "what has been happening",
 * the comparison answers "to whom", and a reader who has both can form the sentence a
 * Monday meeting actually opens with. Separating them into two full-width sections — as
 * the first console layout did with every block on the page — made the reader hold the
 * first answer in their head while scrolling to the second.
 *
 * BOTH ARE DRAWN FROM THE SAME TRAILING WINDOW AND THE SAME SELECTORS AS THE RAIL
 * ------------------------------------------------------------------------------
 * `executive.ts` resolves the window once and every shape on the page is drawn over it,
 * so a column here and a column on a KPI card above cannot describe different months. The
 * values are the same governed selectors the scoreboard uses, evaluated at one store's
 * scope; nothing here is a second calculation of anything.
 *
 * Server components. No client JavaScript, including the metric switch — see
 * `MetricSwitch`, which is a radio group and CSS.
 */
import { Text } from '@/components/ui/typography'
import type {
  ExecutiveOverview,
  StoreComparison as StoreComparisonModel,
  TrendBucket,
} from '@/lib/dashboard/executive'
import {
  formatCountExact,
  formatCurrencyExact,
  formatPerUnitExact,
} from '@/lib/dashboard/format'
import type { MetricResult } from '@/lib/dashboard/selectors'
import type { Exact } from '@/lib/dashboard/decimal'

import {
  MetricSwitch,
  StoreMeasureBars,
  type StoreMeasureGroup,
} from './workspace-visuals'
import { formatMetric, stateLabel } from './metric'
import { TrendChart, type TrendPoint } from './visuals'

/* -------------------------------------------------------------------------- */
/* The primary operating trend                                                 */
/* -------------------------------------------------------------------------- */

/** One selectable series of the primary trend. */
interface TrendSeries {
  readonly id: string
  readonly label: string
  readonly valueHeading: string
  readonly pick: (bucket: TrendBucket) => MetricResult
  readonly format: (value: Exact) => string
}

/**
 * The three measures the primary trend can be read on.
 *
 * WHY THESE THREE AND NOT A FOURTH. They are the rail's three primary cards, which is the
 * whole of the point: the switch lets a reader take the headline figure they just read and
 * see its shape, without going to another page and without a second definition of it. Each
 * `pick` returns a `MetricResult` that `executive.ts` produced from the governed selector
 * of the same name — nothing here divides, sums or derives.
 */
const TREND_SERIES: readonly TrendSeries[] = [
  {
    id: 'units',
    label: 'Retail units',
    valueHeading: 'Units',
    pick: (bucket) => bucket.retailUnits,
    format: formatCountExact,
  },
  {
    id: 'gross',
    label: 'Total gross',
    valueHeading: 'Total gross',
    pick: (bucket) => bucket.totalGross,
    format: (value) => formatCurrencyExact(value),
  },
  {
    id: 'gpru',
    label: 'Total GPRU',
    valueHeading: 'Total gross per retail unit',
    pick: (bucket) => bucket.totalPvr,
    format: formatPerUnitExact,
  },
]

/**
 * Retail volume, total gross or gross per retail unit over the trailing months.
 *
 * MONTHLY, ALWAYS, AND ANCHORED ON THE SELECTION. The Sales and Gross page chooses a
 * granularity from the length of the selected period because its subject IS the shape
 * inside that period. This is the executive anchor: the question is where the selected
 * month sits against the months before it, and a daily strip of thirty columns answers a
 * different one. The window moves with the filter — selecting September genuinely shortens
 * it, because the export begins in July — so the picture is never the same regardless of
 * what the reader asked for.
 *
 * ONE CHART AT A TIME, NOT THREE STACKED AND NOT TWO ON ONE AXIS. Units, dollars and
 * dollars per unit are in three different units; overlaying any two of them needs a second
 * axis, which is the device that makes unrelated shapes look correlated. Stacking all
 * three is what this component did before, and it cost most of a viewport to answer a
 * question a reader asks one measure at a time.
 */
export function OperatingTrend({ trend }: { readonly trend: readonly TrendBucket[] }) {
  const caption = `One column per calendar month, ending with the selected period. ${String(trend.length)} month${trend.length === 1 ? '' : 's'} of the exported reporting window are in scope.`

  return (
    <MetricSwitch
      name="exec-trend"
      legend="Trend measure"
      options={TREND_SERIES.map((series) => ({
        id: series.id,
        label: series.label,
        panel: (
          <TrendChart
            title={series.label}
            caption={caption}
            measure={series.label}
            points={trend.map((bucket): TrendPoint => {
              const result = series.pick(bucket)
              return {
                key: bucket.key,
                label: bucket.label,
                value: result.kind === 'value' ? result.value : null,
                display:
                  result.kind === 'value'
                    ? series.format(result.value)
                    : (stateLabel(result) ?? 'No value'),
              }
            })}
            periodHeading="Month"
            valueHeading={series.valueHeading}
            className="pt-3"
          />
        ),
      }))}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* The store comparison                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Three governed measures across the stores in scope, as one grouped comparison.
 *
 * ONE STORE IS NOT A COMPARISON, AND THE MODULE SAYS SO. When the filter narrows to a
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
    <div className="flex flex-col gap-3">
      <StoreMeasureBars
        title="Store comparison"
        caption="Each measure is scaled to its own largest store. Lengths compare within a measure and never across two."
        groups={overview.comparisons.map(groupOf)}
        singleStoreNotice={
          single
            ? 'One store is in scope, so there is nothing to compare it against. Remove the store filter above to see all three.'
            : undefined
        }
      />
      {/*
        THE ONE SENTENCE THAT SURVIVED. It was a 54-word paragraph naming the three
        operating models and explaining why a league table would be a finding. The models
        are in the table inside the disclosure, in the `Operating model` column, where a
        reader who wants them can read them per store instead of in prose.
      */}
      <Text size="xs" tone="faint" className="max-w-prose">
        Business-code order. Nothing is ranked and no store score exists: the three run
        different operating models.
      </Text>
    </div>
  )
}

function groupOf(comparison: StoreComparisonModel): StoreMeasureGroup {
  return {
    id: comparison.id,
    label: comparison.label,
    kpiId: comparison.selector.kpiId,
    rows: comparison.rows.map((row) => ({
      storeId: row.store.id,
      storeShortName: row.store.shortName,
      storeType: row.store.storeType,
      result: row.result,
      display:
        formatMetric(comparison.selector, row.result) ??
        stateLabel(row.result) ??
        'No value',
    })),
  }
}
