/**
 * The lead funnel and response position.
 *
 * THE FUNNEL IS THE ONE A DEALERSHIP RECOGNISES
 * ---------------------------------------------
 * Leads → Contacted → Appointment set → Showed → Sold. Five stages, five exported additive
 * columns from `vw_lead_funnel`, one row per store per source per campaign per
 * lead-creation date. `UX.2A` turned the four-column table into a nesting a reader can take
 * in at a glance; every stage, every count, every governed rate and every catalogue
 * identifier is the same value from the same selector, and the table is one click away
 * inside the chart's own disclosure.
 *
 * ONLY GOVERNED RATES APPEAR
 * --------------------------
 * Contact rate, appointment-set rate and lead-to-sale conversion are KPI-FUN-002, -003 and
 * -006, each defined against leads received. The "Showed" stage carries a count and no
 * rate, deliberately: show rate (KPI-FUN-004) has a DIFFERENT denominator — eligible
 * appointments, from the appointment dataset — and putting it on a stage measured against
 * leads received would relabel a measure rather than report one. A stage-to-stage
 * percentage invented here would be a new formula, and new formulas belong in reporting
 * views. No benchmark is stated, because this project publishes none.
 *
 * THE COHORT CAVEAT IS NOT SMALL PRINT
 * ------------------------------------
 * Every figure here counts by LEAD CREATION DATE. A lead created in December that sells in
 * February counts in December, and December's conversion therefore looks worst on the day
 * you read it and improves for months afterwards. KPI-FUN-006's caution says so; the module
 * says so where a reader will see it, because a conversion figure read without it is
 * actively misleading.
 *
 * UNANSWERED LEADS STAY VISIBLE. KPI-FUN-008 is blind to a lead nobody answered, so the
 * count of them is printed beside the response figures rather than left to the drill-through
 * — the same rule `DASH.10` set, in a smaller frame.
 *
 * Server component.
 */
import Link from 'next/link'

import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import { exactToApproxNumber } from '@/lib/dashboard/decimal'
import { kpiDefinition, type FunnelSummary } from '@/lib/dashboard/executive'
import { formatCountExact } from '@/lib/dashboard/format'
import type { DashboardFilters } from '@/lib/dashboard/filters'
import { operatingHref } from '@/lib/dashboard/navigation'
import type { ComparedMetric } from '@/lib/dashboard/selectors'
import { ROUTES } from '@/lib/site'

import { FunnelChart, type FunnelStageBar } from './exec-visuals'
import { KpiDefinitionList, MetricReason, formatMetric, stateLabel } from './metric'

export function LeadFunnel({
  funnel,
  comparisonLabel,
  filters,
}: {
  funnel: FunnelSummary
  /** Named on the response figures, so a difference is never against an unnamed period. */
  comparisonLabel: string | null
  /**
   * The reader's current filter state, so the drill-through arrives scoped.
   *
   * Carrying it matters more here than on the other console drill-throughs: a manager who
   * has narrowed to one store and one source and then follows this link expects the BDC
   * page to open on the same population, and a link that silently widened to the whole
   * group would answer a different question than the one they were looking at.
   */
  filters: DashboardFilters
}) {
  const first = funnel.stages[0]
  const base =
    first !== undefined && first.result.kind === 'value'
      ? exactToApproxNumber(first.result.value)
      : 0

  const stages: readonly FunnelStageBar[] = funnel.stages.map((stage) => {
    const resolved = stage.result.kind === 'value'
    const count = resolved ? exactToApproxNumber(stage.result.value) : 0
    /*
     * A zero base has no shares, and drawing five stages at zero width would present
     * "nobody enquired" as "everybody dropped out at the first step". `null` means the
     * proportion is undefined and the row says so.
     */
    const share = base === 0 || !resolved ? null : count / base
    return {
      key: stage.id,
      label: stage.label,
      display:
        stage.result.kind === 'value'
          ? formatCountExact(stage.result.value)
          : (stateLabel(stage.result) ?? 'No matching records'),
      share,
      shareDisplay: share === null ? null : `${(share * 100).toFixed(1)}%`,
      rate:
        stage.rate === null
          ? null
          : {
              display:
                formatMetric(stage.rate.selector, stage.rate.current) ??
                stateLabel(stage.rate.current) ??
                'No value',
              kpiId: stage.rate.selector.kpiId,
            },
    }
  })

  const responses: readonly {
    readonly label: string
    readonly metric: ComparedMetric
  }[] = [
    { label: 'Median response', metric: funnel.medianResponse },
    { label: 'Average response', metric: funnel.averageResponse },
    { label: 'Responded', metric: funnel.respondedLeads },
    { label: 'No recorded response', metric: funnel.unrespondedLeads },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/*
        THE COHORT CAVEAT STAYS VISIBLE, at one line. A conversion figure read without it
        is actively misleading, so it is not behind a disclosure; the rest of the
        explanation, which a reader needs once, is.
      */}
      <Text size="xs" tone="muted" className="max-w-prose">
        Counted by lead-creation date. Recent periods show the lowest conversion and
        improve for months afterwards: cohort maturity, not performance.
      </Text>

      <FunnelChart
        title="Lead funnel"
        stages={stages}
        shareNote="The share is the stage count over leads received: arithmetic on two exported columns, not a governed KPI. The governed rates are named beside each count."
        headingLevel={3}
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line-subtle pt-3 xl:grid-cols-4">
        {responses.map((response) => (
          <div key={response.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-ink-muted">{response.label}</dt>
            <dd className="numeric text-sm font-semibold text-ink">
              {formatMetric(response.metric.selector, response.metric.current) ??
                stateLabel(response.metric.current) ??
                'No value'}
            </dd>
            {/*
              A REFUSAL KEEPS ITS REASON. The median response time is an order statistic
              published at store × lead source × lead-creation date, so at group scope it
              reads "Not derivable at this scope" — and a reader who is given the refusal
              without the scope that would resolve it has been told the console is broken.
              `MetricReason` prints the reason and the resolving scope, and it renders
              only for the state that has one.
            */}
            {response.metric.current.kind === 'value' ? null : (
              <dd>
                <MetricReason result={response.metric.current} />
              </dd>
            )}
          </div>
        ))}
      </dl>

      <Disclosure label="Response bands, and how these figures are calculated">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Responded leads by response band, for the selected period
          </caption>
          <thead>
            <tr>
              <th scope="col" className={HEAD}>
                Response band
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Leads
              </th>
            </tr>
          </thead>
          <tbody>
            {funnel.responseBands.map((band) => (
              <tr key={band.label} className="border-t border-line-subtle">
                <th scope="row" className="py-2 text-left font-medium text-ink-secondary">
                  {band.label}
                </th>
                <td className="numeric py-2 text-right text-ink">
                  {band.result.kind === 'value'
                    ? formatCountExact(band.result.value)
                    : 'No matching records'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Text size="xs" tone="muted" className="max-w-prose">
          Bands are exported counts from the response view, not a derived distribution.
          Leads with no recorded response are excluded from both the median and the mean,
          which is why their count is published beside them: KPI-FUN-008 is blind to a
          lead nobody answered. The median is published at store, lead source and
          lead-creation date, so a group-scoped selection will often decline to resolve it
          — which is the honest answer rather than an average of medians.
          {comparisonLabel === null
            ? ''
            : ` Response figures are for the selected period; the comparison against ${comparisonLabel} is on the sales page that owns the trend.`}
        </Text>
        <div className="flex flex-col gap-6">
          {responses.map((response) => (
            <div key={response.label} className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-ink-secondary">{response.label}</p>
              <KpiDefinitionList
                selector={response.metric.selector}
                definition={
                  response.metric.selector.kpiId === null
                    ? undefined
                    : kpiDefinition(response.metric.selector.kpiId)
                }
              />
            </div>
          ))}
        </div>
      </Disclosure>

      <Text size="xs" tone="faint">
        <Link
          className="underline"
          href={operatingHref(ROUTES.dashboardLeadsMarketing.href, filters)}
        >
          Open this cohort by source and campaign
        </Link>
      </Text>
    </div>
  )
}

const HEAD = 'py-1.5 font-mono text-2xs tracking-wide text-ink-muted uppercase'
