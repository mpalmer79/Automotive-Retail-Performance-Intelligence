/**
 * The inventory risk summary.
 *
 * SEMI-ADDITIVE, AND THE PAGE SAYS SO
 * -----------------------------------
 * Active inventory, investment and aged units are read at ONE snapshot date — the
 * latest the selected period contains — and the date is on the section. KPI-INV-001
 * states the trap plainly: "a month-level card showing a summed daily count is
 * wrong by roughly a factor of 30 and looks plausible". The selector layer makes
 * that impossible; this heading makes it visible.
 *
 * THE MEDIAN TABLE IS THE POINT, NOT A FALLBACK
 * ---------------------------------------------
 * There is no group median inventory age in this data, and there cannot be: a
 * median is an order statistic, the export publishes one per store per condition
 * group per snapshot date, and the catalogue says outright that "group median is not
 * derivable from subgroup medians and must be recomputed from rows". So instead of
 * averaging five medians into a sixth number that is a median of nothing, the
 * section shows all five, at the grain PostgreSQL computed them at. The mean IS
 * derivable and is shown beside them, with the gap between mean and median labelled
 * for what it is: evidence of an aged tail.
 *
 * THE THRESHOLD IS A PROJECT DEFAULT
 * ----------------------------------
 * Sixty days, read from the export's own `aged_threshold_days` column rather than
 * typed here. KPI-INV-005: "different operators use 30, 45, 60, or 90 days. Any
 * finding depending on the threshold must state it in the same sentence." It is not
 * an industry standard and the page does not call it one.
 *
 * WHERE THIS SECTION STOPS
 * ------------------------
 * At the summary. `DASH.9` delivered `/dashboard/inventory`, which holds the 1,501
 * unit-level rows, their age against the threshold, asking price against the synthetic
 * market estimate and the per-unit accounting position. None of that belongs here: the
 * Executive Overview reads eight governed figures and one distribution over a snapshot,
 * and the drill-through below is how a reader gets from the shape to the units behind
 * it. Reproducing the detail page's content on this page would cost 356 kB of chunks
 * this route never opens, which `dashboard-boundaries.test.ts` forbids outright.
 *
 * Server component.
 */
import Link from 'next/link'

import { Card } from '@/components/ui/card-static'
import { Heading, Text } from '@/components/ui/typography'
import { Methodology, MethodologyNote } from '@/components/dashboard/methodology'
import { kpiDefinition, type InventorySummary } from '@/lib/dashboard/executive'
import { exactToString } from '@/lib/dashboard/decimal'
import { formatIsoDate } from '@/lib/dashboard/format'
import type { ComparedMetric } from '@/lib/dashboard/selectors'
import { ROUTES } from '@/lib/site'
import { cx } from '@/lib/utils'

import {
  KpiMethodology,
  MetricDifference,
  MetricReason,
  MetricValue,
  unitLabel,
  valueCarriesUnit,
} from './metric'
import { InventoryAgeStack } from './visuals'

export function InventoryRisk({
  inventory,
  comparisonLabel,
}: {
  inventory: InventorySummary
  comparisonLabel: string | null
}) {
  const figures: readonly { readonly label: string; readonly metric: ComparedMetric }[] =
    [
      { label: 'Active inventory', metric: inventory.activeUnits },
      { label: 'Inventory investment', metric: inventory.investment },
      { label: 'Average age', metric: inventory.averageAge },
      { label: 'Aged units', metric: inventory.agedUnits },
      { label: 'Aged investment', metric: inventory.agedInvestment },
      { label: 'Aged percentage', metric: inventory.agedPercentage },
      { label: 'Dealer days supply', metric: inventory.daysSupply },
      { label: 'Inventory turn', metric: inventory.turn },
    ]

  return (
    <div className="flex flex-col gap-6">
      {/* One sentence. The aged threshold moved onto the age stack, where the colour
          ramp turns on it and a reader needs it; repeating it here was the same
          caveat twice on one screen. The multi-threshold state has no home on the
          stack, so it stays. */}
      <Text size="sm" tone="muted" className="max-w-prose">
        {inventory.snapshotDate === null
          ? 'No inventory snapshot falls inside the selected period.'
          : `Semi-additive: read at the ${formatIsoDate(inventory.snapshotDate)} snapshot, added across stores and condition groups at one date and never across dates.`}
        {inventory.agedThresholdDays === null
          ? ' The scope in view carries more than one aged threshold, so no single threshold is stated.'
          : ''}
      </Text>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {figures.map((figure) => (
          <Card as="li" key={figure.label} padding="sm" className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-sm font-semibold text-ink-secondary">{figure.label}</h3>
              <p className="flex flex-wrap items-center gap-x-2 text-2xs text-ink-faint">
                {figure.metric.selector.kpiId === null ? null : (
                  <span className="font-mono">{figure.metric.selector.kpiId}</span>
                )}
                {valueCarriesUnit(figure.metric.selector) ? null : (
                  <span>{unitLabel(figure.metric.selector)}</span>
                )}
              </p>
            </div>
            <MetricValue
              selector={figure.metric.selector}
              result={figure.metric.current}
            />
            {figure.metric.current.kind === 'value' ? (
              <MetricDifference
                metric={figure.metric}
                comparisonLabel={comparisonLabel}
              />
            ) : (
              <MetricReason result={figure.metric.current} />
            )}
            <KpiMethodology
              selector={figure.metric.selector}
              definition={
                figure.metric.selector.kpiId === null
                  ? undefined
                  : kpiDefinition(figure.metric.selector.kpiId)
              }
            />
          </Card>
        ))}
      </ul>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <AgeDistribution inventory={inventory} />
        <MedianTable inventory={inventory} />
      </div>

      {/* A DRILL-THROUGH IS A LINK, NOT A PARAGRAPH ABOUT ONE. It described the
          destination in thirty-two words a reader had to pass through to reach it;
          the destination describes itself. */}
      <Text size="xs" tone="faint">
        <Link className="underline" href={ROUTES.dashboardInventory.href}>
          Open the units behind these figures
        </Link>
      </Text>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Age distribution                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The aging profile, as one part-to-whole bar with its table underneath.
 *
 * WHAT CHANGED, AND WHY THE OLD BARS WERE WRONG. The first version drew one bar per
 * bucket at a width of that bucket over the LARGEST bucket. That is a comparison of
 * modes, not a distribution: it made the biggest band full-width at every scope, so the
 * picture looked identical whether the lot was evenly spread or entirely aged. The
 * `share` the view model publishes is the bucket over the POPULATION, which is the
 * denominator a distribution actually has, and `InventoryAgeStack` draws that.
 *
 * The table is retained verbatim below the stack. The geometry is decoration; the counts
 * and the shares are the data, and both are text in two places.
 */
function AgeDistribution({ inventory }: { inventory: InventorySummary }) {
  const snapshotNote =
    inventory.snapshotDate === null
      ? 'No inventory snapshot falls inside the selected period.'
      : `Read at the ${formatIsoDate(inventory.snapshotDate)} snapshot, at one date and never summed across dates.`

  return (
    <section aria-labelledby="age-distribution" className="flex flex-col gap-4">
      <InventoryAgeStack
        title="Age distribution"
        caption="Units on the lot by days in stock, on boundaries the exported aging view sets."
        segments={inventory.buckets.map((bucket) => ({
          key: bucket.label,
          label: bucket.label,
          display: `${exactToString(bucket.units)} units`,
          share: bucket.share,
        }))}
        snapshotNote={snapshotNote}
        thresholdDays={inventory.agedThresholdDays}
        headingLevel={3}
      />

      {inventory.buckets.length === 0 ? (
        <Text size="sm" tone="muted">
          No inventory rows fall inside the selected period and scope.
        </Text>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Active inventory units by age bucket at the snapshot date
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="py-1.5 font-mono text-2xs tracking-wide text-ink-muted uppercase"
              >
                Days in stock
              </th>
              <th
                scope="col"
                className="py-1.5 text-right font-mono text-2xs tracking-wide text-ink-muted uppercase"
              >
                Units
              </th>
              <th
                scope="col"
                className="py-1.5 text-right font-mono text-2xs tracking-wide text-ink-muted uppercase"
              >
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {inventory.buckets.map((bucket) => (
              <tr key={bucket.label} className="border-t border-line-subtle">
                <th scope="row" className="py-2 text-left font-medium text-ink-secondary">
                  {bucket.label}
                </th>
                <td className="numeric py-2 pr-3 text-right text-ink">
                  {exactToString(bucket.units)}
                </td>
                <td className="numeric py-2 text-right text-ink-muted">
                  {(bucket.share * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Governed medians                                                            */
/* -------------------------------------------------------------------------- */

function MedianTable({ inventory }: { inventory: InventorySummary }) {
  return (
    <section aria-labelledby="governed-medians" className="flex flex-col gap-3">
      <Heading level={3} size="h6" id="governed-medians">
        Median inventory age, at the grain it is published
      </Heading>
      {/*
        THE CAVEAT IS VISIBLE, THE MECHANISM IS DISCLOSED.

        The one sentence a reader would MISREAD the table without — a group median
        is not the average of store medians — stays on the page. How the median is
        computed, and by what, is methodology: it named the storage engine and the
        aggregate function, in the eye path, on the console's flagship surface.
      */}
      <Text size="xs" tone="muted" className="max-w-prose">
        A median is published per store, per condition group, per snapshot date, and it
        cannot be combined upward: a group median is not the average of store medians. A
        single median appears on a card only when the filter resolves to exactly one of
        the rows below.
      </Text>
      <Methodology>
        <MethodologyNote>
          KPI-INV-004 is an order statistic. It is computed with PERCENTILE_CONT over the
          units themselves in the reporting layer, at store, condition-group and
          snapshot-date grain, which is the grain the export publishes and the finest one
          at which the value is defined.
        </MethodologyNote>
      </Methodology>
      {inventory.governedMedians.length === 0 ? (
        <Text size="sm" tone="muted">
          No inventory rows fall inside the selected period and scope.
        </Text>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Exported median inventory age by store and condition group
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="py-1.5 font-mono text-2xs tracking-wide text-ink-muted uppercase"
              >
                Store
              </th>
              <th
                scope="col"
                className="py-1.5 font-mono text-2xs tracking-wide text-ink-muted uppercase"
              >
                Condition
              </th>
              <th
                scope="col"
                className="py-1.5 text-right font-mono text-2xs tracking-wide text-ink-muted uppercase"
              >
                Median age
              </th>
            </tr>
          </thead>
          <tbody>
            {inventory.governedMedians.map((entry) => (
              <tr
                key={`${entry.store.id}-${entry.conditionGroup}`}
                className="border-t border-line-subtle"
              >
                <th scope="row" className="py-2 text-left font-medium text-ink-secondary">
                  {entry.store.shortName}
                </th>
                <td className="py-2 text-ink-muted">{entry.conditionGroup}</td>
                <td className={cx('py-2 text-right')}>
                  {entry.value.kind === 'value' ? (
                    <span className="numeric text-ink">
                      {exactToString(entry.value.value)} days
                    </span>
                  ) : (
                    <span className="text-ink-muted">
                      {entry.value.kind === 'not-applicable'
                        ? 'Not applicable'
                        : 'No eligible population'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
