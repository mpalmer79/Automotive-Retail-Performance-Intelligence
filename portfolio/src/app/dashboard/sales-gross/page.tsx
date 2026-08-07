import type { Metadata } from 'next'

import { Canvas } from '@/components/shell/field'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import {
  FilterNotice,
  NoMatchingRecords,
  PeriodNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import {
  BridgeSection,
  ContributionSection,
  DistributionSection,
  MixSection,
  PerformanceGrid,
  TrendSection,
} from '@/components/dashboard/sales-gross-sections'
import { Badge } from '@/components/ui/badge'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { Text } from '@/components/ui/typography'
import {
  calendarMonths,
  dashboardConditionGroups,
  dashboardLeadSources,
  dashboardManifest,
  dashboardStores,
} from '@/lib/dashboard/data'
import { parseFilters, type QueryInput } from '@/lib/dashboard/filters'
import { formatIsoDate, formatIsoMonth } from '@/lib/dashboard/format'
import { buildSalesGross } from '@/lib/dashboard/sales-gross'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardSalesGross')

const ROUTE = ROUTES.dashboardSalesGross.href

/**
 * Sales and gross — the GSM surface.
 *
 * WHAT THIS PAGE IS FOR
 * ---------------------
 * A general sales manager arrives from the Executive Overview holding one
 * observation: gross moved. This page answers what moved with it. Volume and rate
 * are separated, the mix behind them is shown, the discount taken against asking
 * price is shown, the shape of the deal population is shown, and the bridge states
 * how much of the change the documented decomposition assigns to each.
 *
 * SECTION ORDER IS THE DIAGNOSTIC ORDER
 * -------------------------------------
 * Totals, then the trend, then the mix, then where the gross came from, then what
 * was given away, then the distribution, then the bridge. The bridge is LAST on
 * purpose: it is the most interpretive thing on the page, and a reader who has
 * already seen units, rate and mix reads it as a summary rather than as a verdict.
 *
 * A SERVER COMPONENT. One client island, the filter bar, receives option lists and
 * no data. With scripting disabled every figure, every table and every chart's data
 * alternative is still in the document, and the filter form degrades to the native
 * GET submission it already is.
 */
export default async function SalesGrossPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = (await searchParams) as QueryInput
  const parsed = parseFilters(query, {
    knownStores: dashboardStores.map((store) => store.id),
    knownSources: dashboardLeadSources.map((source) => source.code),
  })
  const view = buildSalesGross(parsed.filters)

  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)
  const failedReconciliation = reconciliationFailed(dashboardManifest)
  const comparisonLabel = view.periodContext.comparison?.label ?? null

  return (
    <Canvas>
      <PageHeader
        eyebrow="Dealer Operations Command Center"
        title="What sold, what it made, and what changed"
        crumbLabel="Sales and gross"
        lede={`Volume, gross and gross per retail unit for ${view.scope.label.toLowerCase()}, over ${view.periodContext.period.label}. Every figure is summed from the governed SQL export, and every rate is recomputed from its own numerator and denominator rather than averaged from a published one.`}
        dashboardNav
        trustScope="dashboard"
        meta={
          <>
            <Badge tone="neutral" mono>
              Dataset v{exportState.datasetVersion} · {exportState.profile}
            </Badge>
            <Badge tone="neutral" mono>
              As of {formatIsoDate(view.asOfDate)}
            </Badge>
            <Badge tone={powerBi.validated ? 'verified' : 'pending'}>
              {powerBi.validated
                ? 'Real-engine validation recorded'
                : 'Real-engine validation pending'}
            </Badge>
          </>
        }
      />

      {/* ------------------------------------------------------------------ */}
      {/* Context and controls                                                */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="none" tone="evidence" className="py-section-tight" id="context">
        <Container width="full">
          <div className="flex flex-col gap-6">
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={failedReconciliation} />
            <FilterNotice resets={parsed.reset} resetHref={ROUTE} />
            <PeriodNotice notices={view.periodContext.notices} />

            <dl className="grid gap-4 border-y border-line py-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Period</dt>
                <dd className="text-sm text-ink">{view.periodContext.period.label}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  Comparison
                </dt>
                <dd className="text-sm text-ink">
                  {comparisonLabel ?? view.periodContext.comparisonLabel}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Scope</dt>
                <dd className="text-sm text-ink">{view.scope.label}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  Data as of
                </dt>
                <dd className="text-sm text-ink">{formatIsoDate(view.asOfDate)}</dd>
              </div>
            </dl>

            {/* Every active parameter, including the ones this route cannot act on.
                A filter that is in the URL and not in this summary is a filter the
                reader believes is working. */}
            {view.chips.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {view.chips.map((chip) => (
                  <li
                    key={chip.key}
                    className="inline-flex min-h-6 items-center gap-1.5 rounded-pill border border-line-subtle bg-surface px-2.5 py-1 text-xs"
                  >
                    <span className="text-ink-muted">{chip.label}</span>{' '}
                    <span className="text-ink">{chip.value}</span>
                    {chip.support === 'applied' ? null : (
                      <span className="text-ink-faint">
                        {chip.support === 'partial'
                          ? '· partly applied'
                          : '· not applied here'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}

            <FilterBar
              action={ROUTE}
              filters={parsed.filters}
              periodOptions={periodOptions()}
              stores={storeOptions()}
              conditions={conditionOptions()}
              leadSources={leadSourceOptions()}
              conditionHint="New and Used select the exported condition split of units and gross."
              leadSourceHint="Not applied on this page. Deal-level attribution is in the Deal Explorer."
            />
          </div>
        </Container>
      </Section>

      {view.empty ? (
        <Section rhythm="default">
          <Container width="content">
            <NoMatchingRecords
              filterSummary={`${view.periodContext.period.label}, ${view.scope.label}.`}
              resetHref={ROUTE}
            />
          </Container>
        </Section>
      ) : (
        <>
          {/* -------------------------------------------------------------- */}
          {/* Performance                                                     */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="performance">
            <Container width="full">
              <SectionHeader
                eyebrow="Performance"
                title="Volume and gross, with the rate that connects them"
                lede={
                  view.conditionFilterApplied
                    ? 'Units and gross are read from the exported condition split, so the selected condition changes which governed column is summed rather than re-filtering a total that carries no split.'
                    : 'Nine governed figures. The three per-unit rates share one denominator, which is what makes total PVR the sum of front and back PVR rather than a coincidence.'
                }
              />
              <div className="pt-6">
                <PerformanceGrid
                  metrics={view.performance}
                  comparisonLabel={comparisonLabel}
                />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Trend                                                           */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" tone="evidence" id="trend">
            <Container width="full">
              <SectionHeader
                eyebrow="Trend"
                title="How the period accumulated"
                lede="Columns rather than a line: there is no gross between Tuesday and Wednesday, and a line would imply one. Each chart carries its own data table, present in the document whether or not it is opened."
              />
              <div className="pt-6">
                <TrendSection series={view.series} comparisonLabel={comparisonLabel} />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Mix                                                             */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="mix">
            <Container width="full">
              <SectionHeader
                eyebrow="Mix"
                title="What the volume was made of"
                lede="Condition and store carry both units and gross because the export publishes both. Sale type carries units only, and says so: apportioning the retail gross across sale types would invent a measure no reporting view owns."
              />
              <div className="pt-6">
                <MixSection mixes={view.mixes} />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Where the gross came from, and what was given away              */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" tone="evidence" id="contribution">
            <Container width="full">
              <SectionHeader
                eyebrow="Gross composition"
                title="Front and back, and the discount taken to get there"
                lede="The finance office's contribution is shown beside the vehicle's, and the discount against each asking price is shown per retail unit. The MSRP discount divides by the units that actually carry an MSRP, which is fewer than the retail count."
              />
              <div className="grid gap-6 pt-6 lg:grid-cols-2">
                <ContributionSection
                  front={view.contribution.front}
                  back={view.contribution.back}
                  frontShare={view.contribution.frontShare}
                  backShare={view.contribution.backShare}
                />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <PerformanceGrid
                    metrics={view.discounts}
                    comparisonLabel={comparisonLabel}
                  />
                </div>
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Distribution                                                    */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="distribution">
            <Container width="full">
              <SectionHeader
                eyebrow="Distribution"
                title="The shape of the deal population, not just its average"
                lede="Deal gross has a long tail, so the mean sits above the typical deal. Median and mean are shown together because either alone invites the wrong conclusion."
              />
              <div className="pt-6">
                <DistributionSection distribution={view.distribution} />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Bridge                                                          */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" tone="evidence" id="bridge">
            <Container width="full">
              <SectionHeader
                eyebrow="Gross change"
                title="What the decomposition attributes the change to"
                lede="An attribution under a documented arithmetic order, computed in SQL and verified here. It reports how the change divides between selling a different number of units and earning a different amount per unit. It does not say why either moved."
              />
              <div className="pt-6">
                <BridgeSection bridge={view.bridge} />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Where to go next                                                */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="next">
            <Container width="content">
              <Text size="sm" tone="muted">
                Every figure on this page is the sum of finalized transactions. To see the
                transactions themselves, open the{' '}
                <a
                  href={ROUTES.dashboardDeals.href}
                  className="inline-flex min-h-6 items-center underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                >
                  Deal Explorer
                </a>
                , which carries the same period and store selection.
              </Text>
            </Container>
          </Section>
        </>
      )}
    </Canvas>
  )
}

/* -------------------------------------------------------------------------- */
/* Filter options                                                              */
/* -------------------------------------------------------------------------- */
// Built from the export's own enumerations, never hard-coded: an option the data
// cannot produce is an invitation to a view that renders nothing.

function periodOptions(): readonly FilterOption[] {
  return calendarMonths.map((month) => ({
    value: month,
    label: formatIsoMonth(month),
  }))
}

function storeOptions(): readonly FilterOption[] {
  return dashboardStores.map((store) => ({ value: store.id, label: store.shortName }))
}

function conditionOptions(): readonly FilterOption[] {
  return dashboardConditionGroups.map((group) => ({ value: group, label: group }))
}

function leadSourceOptions(): readonly FilterOption[] {
  return dashboardLeadSources.map((source) => ({
    value: source.code,
    label: source.name,
  }))
}
