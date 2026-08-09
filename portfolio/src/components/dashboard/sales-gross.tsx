/**
 * Sales and gross, in brief.
 *
 * TWO COMPOSITIONS AND ONE CARD, WHERE THERE WERE FIVE CARDS
 * ----------------------------------------------------------
 * The five figures are unchanged and all five are still on the page. What changed is
 * that four of them are now shown as the two part-to-whole readings they actually are —
 * front against back, and new against used — because "where did the gross come from" and
 * "what is the unit mix" are share questions, and a share question answered by two
 * numbers side by side makes the reader do the division. The fifth, front gross per
 * retail unit, is a rate rather than a part of anything, so it stays a card.
 *
 * THE DENOMINATORS ARE GOVERNED TOTALS, NOT SUMS OF THE SEGMENTS
 * --------------------------------------------------------------
 * Total gross and retail units come from their own selectors and are handed to the
 * primitives as denominators. Neither is PRINTED here: both are already in the KPI row
 * above, and a console that shows the same figure twice on one screen invites a reader
 * to check whether the two agree. A component may not add the segments together to find
 * the whole in any case — `dashboard-boundaries.test.ts` forbids exact arithmetic in a
 * component, and that rule is what keeps this honest rather than merely tidy.
 *
 * NO SHARE PERCENTAGE IS PRINTED, AND THE ABSENCE IS CORRECT
 * ----------------------------------------------------------
 * A back-gross share of total is a ratio, and every ratio on this console comes from a
 * governed selector with a catalogue entry behind it. There is no such KPI, and dividing
 * two exported columns here to produce one would be the console defining a measure —
 * exactly what ADR-0013 condition 2 forbids. The bar shows the proportion, the amounts
 * are printed, and `/dashboard/sales-gross` — which owns the contribution analysis and
 * computes the share in its own view model — is one link away.
 *
 * Server component.
 */
import { Card } from '@/components/ui/card-static'
import { Text } from '@/components/ui/typography'
import { kpiDefinition, type SalesGrossSummary } from '@/lib/dashboard/executive'
import type { ComparedMetric } from '@/lib/dashboard/selectors'

import {
  KpiMethodology,
  MetricDifference,
  MetricReason,
  MetricValue,
  formatMetric,
  unitLabel,
  valueCarriesUnit,
} from './metric'
import { GrossComposition, type CompositionSegment } from './visuals'

export function SalesAndGross({
  salesGross,
  comparisonLabel,
}: {
  salesGross: SalesGrossSummary
  comparisonLabel: string | null
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <GrossComposition
          title="Front and back gross"
          caption="The two components of total gross for the selected scope, drawn against the governed total."
          segments={segmentsOf([
            ['front', 'Front-end gross', salesGross.frontGross],
            ['back', 'Back-end gross', salesGross.backGross],
          ])}
          total={
            salesGross.totalGross.current.kind === 'value'
              ? salesGross.totalGross.current.value
              : null
          }
          shareDisclosure="Front and back are published separately and are not ranked against each other. A store can hold total gross steady while front collapses and the finance office compensates, and which of those is preferable depends on the store rather than on the figure. The contribution share is computed on the sales and gross page, which owns it."
        />

        <GrossComposition
          title="New and used mix"
          caption="The exported unit split for the selected scope, drawn against governed retail units."
          segments={segmentsOf([
            ['new', 'New units', salesGross.newUnits],
            ['used', 'Used units', salesGross.usedUnits],
          ])}
          total={
            salesGross.retailUnits.current.kind === 'value'
              ? salesGross.retailUnits.current.value
              : null
          }
          shareDisclosure="The independent pre-owned store contributes no new units, and its scoreboard cell says so in words rather than with a zero. Wholesale disposals and dealer trades are excluded from every retail figure on this page, per KPI-SLS-001: the export publishes all-types totals as separate columns and this console never mixes the two."
        />
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FigureCard
          label="Front gross per retail unit"
          metric={salesGross.frontPvr}
          comparisonLabel={comparisonLabel}
        />
      </ul>

      <Text size="xs" tone="faint" className="max-w-prose">
        Total gross and total gross per retail unit are in the KPI row above and are not
        repeated here.
      </Text>
    </div>
  )
}

/**
 * Turn compared metrics into drawable segments, dropping any the scope did not resolve.
 *
 * A segment whose metric is `no-rows` or `null-ratio` is omitted rather than drawn at
 * zero, for the same reason the comparison bars omit a structural absence: a zero-width
 * slice and an unresolved measure look identical, and only one of them is a measurement.
 */
function segmentsOf(
  entries: readonly (readonly [string, string, ComparedMetric])[]
): readonly CompositionSegment[] {
  const segments: CompositionSegment[] = []
  for (const [key, label, metric] of entries) {
    if (metric.current.kind !== 'value') continue
    const display = formatMetric(metric.selector, metric.current)
    if (display === null) continue
    segments.push({ key, label, value: metric.current.value, display })
  }
  return segments
}

function FigureCard({
  label,
  metric,
  comparisonLabel,
}: {
  label: string
  metric: ComparedMetric
  comparisonLabel: string | null
}) {
  return (
    <Card as="li" padding="sm" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-ink-secondary">{label}</h3>
        <p className="flex flex-wrap items-center gap-x-2 text-2xs text-ink-faint">
          {metric.selector.kpiId === null ? null : (
            <span className="font-mono">{metric.selector.kpiId}</span>
          )}
          {valueCarriesUnit(metric.selector) ? null : (
            <span>{unitLabel(metric.selector)}</span>
          )}
        </p>
      </div>
      <MetricValue selector={metric.selector} result={metric.current} size="sub" />
      {metric.current.kind === 'value' ? (
        <MetricDifference metric={metric} comparisonLabel={comparisonLabel} />
      ) : (
        <MetricReason result={metric.current} />
      )}
      <KpiMethodology
        selector={metric.selector}
        definition={
          metric.selector.kpiId === null
            ? undefined
            : kpiDefinition(metric.selector.kpiId)
        }
      />
    </Card>
  )
}
