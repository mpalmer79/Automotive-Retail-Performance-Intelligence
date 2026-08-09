/**
 * The lead funnel and response time.
 *
 * THE FUNNEL IS THE ONE A DEALERSHIP RECOGNISES
 * ---------------------------------------------
 * Leads → Contacted → Appointment set → Showed → Sold. Five stages, five exported
 * additive columns from `vw_lead_funnel`, one row per store per source per campaign
 * per lead-creation date. The bars are proportions of the first stage and carry
 * their own counts, so the geometry is decoration and the numbers are the data.
 *
 * ONLY GOVERNED RATES APPEAR
 * --------------------------
 * Contact rate, appointment-set rate and lead-to-sale conversion are KPI-FUN-002,
 * -003 and -006, each defined against leads received. The "Showed" stage carries a
 * count and no rate, deliberately: show rate (KPI-FUN-004) has a DIFFERENT
 * denominator — eligible appointments, from the appointment dataset — and putting
 * it on a stage measured against leads received would relabel a measure rather than
 * report one. A stage-to-stage percentage invented here would be a new formula, and
 * new formulas belong in reporting views.
 *
 * THE COHORT CAVEAT IS NOT SMALL PRINT
 * ------------------------------------
 * Every figure here counts by LEAD CREATION DATE. A lead created in December that
 * sells in February counts in December, and December's conversion therefore looks
 * worst on the day you read it and improves for months afterwards. KPI-FUN-006's
 * caution says so; the section says so where a reader will see it, because a
 * conversion figure read without it is actively misleading.
 *
 * RESPONSE TIME: THE MEDIAN IS THE HEADLINE AND IT USUALLY CANNOT RESOLVE
 * ----------------------------------------------------------------------
 * KPI-FUN-008 is the right headline — the mean is dragged by a handful of leads
 * answered a day late — and the export publishes it at store × lead source ×
 * lead-creation date, because a median cannot be combined upward. So the median
 * card states its scope honestly and names the filter that resolves it, the mean is
 * shown beside it as the derivable figure it is, and the governed response bands
 * carry the distribution the mean hides. That is the available valid scope, rather
 * than an average of medians dressed as one.
 *
 * Server component.
 */
import Link from 'next/link'

import { Card } from '@/components/ui/card-static'
import { Heading, Text } from '@/components/ui/typography'
import { exactToApproxNumber } from '@/lib/dashboard/decimal'
import { kpiDefinition, type FunnelSummary } from '@/lib/dashboard/executive'
import { formatCountExact } from '@/lib/dashboard/format'
import { filtersHref, type DashboardFilters } from '@/lib/dashboard/filters'
import type { ComparedMetric } from '@/lib/dashboard/selectors'
import { ROUTES } from '@/lib/site'

import {
  KpiMethodology,
  MetricDifference,
  MetricReason,
  MetricValue,
  formatMetric,
  unitLabel,
  valueCarriesUnit,
} from './metric'

export function LeadFunnel({
  funnel,
  comparisonLabel,
  filters,
}: {
  funnel: FunnelSummary
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

  return (
    <div className="flex flex-col gap-6">
      {/*
        THE COHORT CAVEAT STAYS VISIBLE. It is compressed to one line, not moved behind a
        disclosure: a conversion figure read without it is actively misleading, and the
        rest of the explanation — which a reader needs only once — is one tap away.
      */}
      <Text size="sm" tone="muted" className="max-w-prose">
        Counted by lead-creation date. Recent periods show the lowest conversion and
        improve for months afterwards. That is cohort maturity, not performance.
      </Text>

      <section aria-labelledby="funnel-stages" className="flex flex-col gap-3">
        <Heading level={3} size="h6" id="funnel-stages">
          Stages
        </Heading>
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Lead funnel stage counts and governed conversion rates for the selected period
          </caption>
          <thead>
            <tr>
              <th scope="col" className={HEAD}>
                Stage
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Leads
              </th>
              <th scope="col" className={`${HEAD} w-2/5`}>
                Share of leads received
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Governed rate
              </th>
            </tr>
          </thead>
          <tbody>
            {funnel.stages.map((stage) => {
              const resolved = stage.result.kind === 'value'
              const count = resolved ? exactToApproxNumber(stage.result.value) : 0
              /*
               * A zero base has no shares, and drawing five stages at zero width would
               * present "nobody enquired" as "everybody dropped out at the first step".
               * `null` means the proportion is undefined and the cell says so.
               */
              const share = base === 0 || !resolved ? null : count / base
              return (
                <tr key={stage.id} className="border-t border-line-subtle">
                  <th scope="row" className="py-2.5 text-left font-medium text-ink">
                    {stage.label}
                  </th>
                  <td className="numeric py-2.5 pr-3 text-right text-ink">
                    {stage.result.kind === 'value'
                      ? formatCountExact(stage.result.value)
                      : 'No matching records'}
                  </td>
                  <td className="py-2.5">
                    {share === null ? (
                      <span className="text-2xs text-ink-faint">
                        No proportion is defined without leads received
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        {/*
                         * ONE HUE, AND NO RAMP DOWN THE STAGES. A funnel is a NESTING
                         * -- each stage is a subset of the one above it -- so the
                         * narrowing width already carries the whole progression. A
                         * colour ramp over the stages would have to say which end is
                         * the good end, and this console publishes no governed
                         * favourable direction for conversion.
                         */}
                        <span
                          aria-hidden="true"
                          className="h-3 min-w-px rounded-pill bg-data-primary"
                          style={{ width: `${(share * 100).toFixed(1)}%` }}
                        />
                        <span className="numeric shrink-0 text-2xs text-ink-faint">
                          {(share * 100).toFixed(1)}%
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="numeric py-2.5 text-right">
                    {stage.rate === null ? (
                      <span className="text-2xs text-ink-faint">
                        No governed rate at this stage
                      </span>
                    ) : (
                      <span className="flex flex-col items-end">
                        <MetricValue
                          selector={stage.rate.selector}
                          result={stage.rate.current}
                        />
                        <span className="font-mono text-2xs text-ink-faint">
                          {stage.rate.selector.kpiId}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {/*
          ALSO LOAD-BEARING, AND MORE SO NOW THAT THE BAR IS THE PRIMARY READING. A reader
          who takes the proportion off the length has to know it is not one of the
          governed rates in the column beside it.
        */}
        <Text size="xs" tone="faint" className="max-w-prose">
          The share is the stage count over leads received: arithmetic on two exported
          columns for the bar, not a governed KPI. The governed rates are the last column,
          with their catalogue identifiers.
        </Text>
      </section>

      <section aria-labelledby="response-time" className="flex flex-col gap-3">
        <Heading level={3} size="h6" id="response-time">
          Response time
        </Heading>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ResponseCard
            label="Median response time"
            metric={funnel.medianResponse}
            comparisonLabel={comparisonLabel}
          />
          <ResponseCard
            label="Average response time"
            metric={funnel.averageResponse}
            comparisonLabel={comparisonLabel}
          />
          <ResponseCard
            label="Leads responded to"
            metric={funnel.respondedLeads}
            comparisonLabel={comparisonLabel}
          />
          <ResponseCard
            label="No recorded response"
            metric={funnel.unrespondedLeads}
            comparisonLabel={comparisonLabel}
          />
        </ul>

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
        <Text size="xs" tone="faint" className="max-w-prose">
          Bands are exported counts from the response view, not a derived distribution.
          Leads with no recorded response are excluded from both the median and the mean,
          which is why their count is published beside them: KPI-FUN-008 is blind to a
          lead nobody answered.
        </Text>
      </section>

      {/*
        `DASH.10`. The investigation path out of this summary.

        This section answers "what did the funnel do"; it cannot answer "which source did
        it, how fast did we answer, and what did the spend buy", because the Executive page
        reads `lead-funnel` and `lead-response` and deliberately carries none of the BDC
        detail. The link is the whole extent of this increment's change to the Executive
        Overview -- route activation, not a redesign.
      */}
      <Text size="xs" tone="faint" className="max-w-prose">
        <Link
          className="underline"
          href={filtersHref(ROUTES.dashboardLeadsMarketing.href, filters)}
        >
          Open leads and marketing
        </Link>{' '}
        for this cohort by source and campaign: where it stopped progressing, the full
        first-response distribution with the leads nobody answered, appointment outcomes
        on their own two date bases, and what the spend behind these leads bought. Your
        current filters travel with the link.
      </Text>
    </div>
  )
}

const HEAD =
  'py-1.5 font-mono text-2xs tracking-wide text-ink-muted uppercase align-bottom'

function ResponseCard({
  label,
  metric,
  comparisonLabel,
}: {
  label: string
  metric: ComparedMetric
  comparisonLabel: string | null
}) {
  const formatted = formatMetric(metric.selector, metric.current)
  return (
    <Card as="li" padding="sm" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h4 className="text-sm font-semibold text-ink-secondary">{label}</h4>
        <p className="flex flex-wrap items-center gap-x-2 text-2xs text-ink-faint">
          {metric.selector.kpiId === null ? null : (
            <span className="font-mono">{metric.selector.kpiId}</span>
          )}
          {valueCarriesUnit(metric.selector) ? null : (
            <span>{unitLabel(metric.selector)}</span>
          )}
        </p>
      </div>
      <MetricValue selector={metric.selector} result={metric.current} />
      {formatted === null ? (
        <MetricReason result={metric.current} />
      ) : (
        <MetricDifference metric={metric} comparisonLabel={comparisonLabel} />
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
