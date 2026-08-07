/**
 * Sales and gross, in brief.
 *
 * Five exported totals: the new and used unit split, front and back gross, and
 * front gross per retail unit. Total gross and total PVR are already in the KPI row
 * above and are not repeated here, because a console that shows the same figure
 * twice on one screen invites a reader to check whether the two agree.
 *
 * WHAT IS NOT HERE, AND WHY THE ABSENCE IS CORRECT
 * ------------------------------------------------
 * No trend line and no gross-change bridge. A bridge attributes movement to volume,
 * mix, front and back, and doing that needs the driver model `DASH.3` builds
 * against a deal-grain reporting view that does not exist yet. Two period totals and
 * a subtraction would produce a chart that looks like a bridge and decomposes
 * nothing — which is a worse outcome than an absent section, because the absent
 * section cannot be misread.
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
  unitLabel,
  valueCarriesUnit,
} from './metric'

export function SalesAndGross({
  salesGross,
  comparisonLabel,
}: {
  salesGross: SalesGrossSummary
  comparisonLabel: string | null
}) {
  const figures: readonly { readonly label: string; readonly metric: ComparedMetric }[] =
    [
      { label: 'New units', metric: salesGross.newUnits },
      { label: 'Used units', metric: salesGross.usedUnits },
      { label: 'Front-end gross', metric: salesGross.frontGross },
      { label: 'Back-end gross', metric: salesGross.backGross },
      { label: 'Front gross per retail unit', metric: salesGross.frontPvr },
    ]

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
      <Text size="xs" tone="faint" className="max-w-prose">
        Wholesale disposals and dealer trades are excluded from every retail figure on
        this page, per KPI-SLS-001. The export publishes all-types totals as separate
        columns and this console never mixes the two. New and used are the exported unit
        split; the independent pre-owned store contributes no new units, and its
        scoreboard cell says so in words rather than with a zero.
      </Text>
    </div>
  )
}
