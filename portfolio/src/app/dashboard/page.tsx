import type { Metadata } from 'next'

import { Canvas } from '@/components/shell/field'
import { ContextRail } from '@/components/dashboard/context-rail'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { InventoryRisk } from '@/components/dashboard/inventory-risk'
import { ReconciliationSignal } from '@/components/dashboard/reconciliation-signal'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { LeadFunnel } from '@/components/dashboard/lead-funnel'
import { SalesAndGross } from '@/components/dashboard/sales-gross'
import {
  FilterNotice,
  NoMatchingRecords,
  PeriodNotice,
  PlannedSections,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { StoreScoreboard } from '@/components/dashboard/store-scoreboard'
import { TargetPaceSection } from '@/components/dashboard/target-context'
import { TrustPanel } from '@/components/dashboard/trust-panel'
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
import {
  SCOREBOARD_COLUMNS,
  buildAccountingSignal,
  buildExecutiveOverview,
  type ExecutiveOverview,
} from '@/lib/dashboard/executive'
import { parseFilters, type QueryInput } from '@/lib/dashboard/filters'
import { formatIsoDate, formatIsoMonth } from '@/lib/dashboard/format'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { PLANNED_DASHBOARD_SECTIONS, ROUTES, SYNTHETIC_DATA_STATEMENT } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboard')

const ROUTE = ROUTES.dashboard.href

/**
 * The ARPI Dealer Operations Command Center — the executive overview.
 *
 * A SERVER COMPONENT, AND ALMOST ALL OF IT STAYS ONE
 * --------------------------------------------------
 * Every figure, table, funnel and disclosure on this page is rendered on the
 * server from a build-packaged export. One client island exists — the filter
 * controls — and it receives five option lists and no data. That is what makes the
 * no-JavaScript guarantee real rather than aspirational: with scripting disabled
 * the KPI row, the scoreboard, the inventory summary, the funnel, the trust panel
 * and the synthetic disclosure are all present, and the filter form degrades to a
 * native GET submission because that is what it already is.
 *
 * WHY IT READS `searchParams`
 * ---------------------------
 * Filter state lives in the URL and nowhere else, so this route is rendered per
 * request. There is no database behind that request: the data was packaged at
 * build time and the "query" is an array pass over it.
 *
 * SECTION ORDER IS OPERATING HIERARCHY
 * ------------------------------------
 * Context, then filters, then the seven governed KPIs, then the store scoreboard,
 * then sales and gross in brief, then inventory risk, then the funnel, then the
 * evidence. A general manager reads down that list in a Monday meeting; a card
 * wall would present all of it as equally urgent, which is the opposite of what an
 * operating report is for.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = (await searchParams) as QueryInput

  const parsed = parseFilters(query, {
    knownStores: dashboardStores.map((store) => store.id),
    knownSources: dashboardLeadSources.map((source) => source.code),
  })
  const overview = buildExecutiveOverview(parsed.filters, parsed.reset)

  const accountingSignal = buildAccountingSignal(parsed.filters)
  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)
  const failedReconciliation = reconciliationFailed(dashboardManifest)

  const comparisonLabel = overview.periodContext.comparison?.label ?? null

  return (
    <Canvas>
      <PageHeader
        eyebrow="Dealer Operations Command Center"
        title="How the group is performing, and which store needs attention"
        crumbLabel="Dealer Operations Command Center"
        lede={`Retail volume, gross and gross per retail unit, inventory risk and the lead funnel for ${overview.scope.label.toLowerCase()}, over ${overview.periodContext.period.label}. Every figure is read from a governed SQL export and reconciles to it exactly.`}
        dashboardNav
        trustScope="dashboard"
        meta={
          <>
            <Badge tone="neutral" mono>
              Dataset v{exportState.datasetVersion} · {exportState.profile}
            </Badge>
            <Badge tone="neutral" mono>
              As of {formatIsoDate(exportState.asOfDate)}
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
            <FilterNotice resets={overview.resets} resetHref={ROUTE} />
            <PeriodNotice notices={overview.periodContext.notices} />

            <ContextRail
              overview={overview}
              route={ROUTE}
              datasetVersion={exportState.datasetVersion}
              contractFingerprint={exportState.contractFingerprint}
            />

            <FilterBar
              action={ROUTE}
              filters={overview.filters}
              periodOptions={periodOptions(overview)}
              stores={storeOptions()}
              conditions={conditionOptions()}
              leadSources={leadSourceOptions()}
            />

            {/* The full statement, on the console itself. `TrustLine` carries the
                compact form in the header; IA §8 puts the long one here, on the
                one page whose figures a reader is most likely to quote. */}
            <Text
              size="sm"
              tone="muted"
              className="max-w-prose border-t border-line pt-4"
            >
              {SYNTHETIC_DATA_STATEMENT}
            </Text>
          </div>
        </Container>
      </Section>

      {overview.empty ? (
        <Section rhythm="default">
          <Container width="content">
            <NoMatchingRecords
              filterSummary={`${overview.periodContext.period.label}, ${overview.scope.label}.`}
              resetHref={ROUTE}
            />
          </Container>
        </Section>
      ) : (
        <>
          {/* -------------------------------------------------------------- */}
          {/* Primary KPI row                                                 */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="group-performance">
            <Container width="full">
              <SectionHeader
                eyebrow="Group performance"
                title="The seven figures the group is run on"
                lede="Each card names the governed KPI it resolves to, its unit, and the difference against the comparison period. Direction is stated in neutral words: this console has no governed favourable direction for these measures, and inventing one would be a judgement rather than a figure."
              />
              <div className="pt-6">
                <KpiStrip
                  cards={overview.cards}
                  comparisonLabel={comparisonLabel}
                  comparisonUnavailable={overview.periodContext.comparisonUnavailable}
                />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Targets and selling-day pace                                    */}
          {/* -------------------------------------------------------------- */}
          {/*
            Secondary to the KPI row above it, and deliberately so: the actual is the
            business result and the plan is the management context beside it. Nothing
            here is a forecast — the projected figure is arithmetic over the governed
            selling-day calendar and carries that name wherever it appears.
          */}
          <Section rhythm="default" id="targets">
            <Container width="full">
              <SectionHeader
                eyebrow="Targets and pace"
                title="What the month was committed to, and where the rate lands it"
                lede="Actual against plan, the selling days elapsed and remaining, the current rate per selling day, and where the month finishes if that rate holds. The projection is linear arithmetic over the governed selling-day calendar, never a forecast, a prediction or a statistical model, and the targets are synthetic operating goals for a fictional group rather than benchmarks."
              />
              <div className="pt-6">
                <TargetPaceSection context={overview.targets} />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Store scoreboard                                                */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" tone="evidence" id="store-scoreboard">
            <Container width="full">
              <SectionHeader
                eyebrow="Store scoreboard"
                title="Three operating models, side by side and not ranked"
                lede="A volume franchise, an all-weather franchise and an independent pre-owned centre. Cells that a store cannot have read Not applicable rather than zero, because a zero in a performance column is read as performance."
              />
              <div className="flex flex-col gap-4 pt-6">
                <StoreScoreboard
                  rows={overview.scoreboard}
                  columns={SCOREBOARD_COLUMNS}
                  caption={`Store scoreboard for ${overview.periodContext.period.label}`}
                />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Sales and gross, in brief                                       */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="sales-and-gross">
            <Container width="full">
              <SectionHeader
                eyebrow="Sales and gross"
                title="Where the gross came from"
                lede="Front and back gross, and the new and used split, for the selected scope. The trend, the mix decomposition and the deal-level explorer are the sales and gross page, delivered by DASH.3."
              />
              <div className="pt-6">
                <SalesAndGross
                  salesGross={overview.salesGross}
                  comparisonLabel={comparisonLabel}
                />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Inventory risk                                                  */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" tone="evidence" id="inventory-risk">
            <Container width="full">
              <SectionHeader
                eyebrow="Inventory"
                title="What is on the lot, and how long it has been there"
                lede="An executive summary at one snapshot date. Unit-level aging, price to market and stock drill-through are on the inventory operations page."
              />
              <div className="pt-6">
                <InventoryRisk
                  inventory={overview.inventory}
                  comparisonLabel={comparisonLabel}
                />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Accounting integrity (DASH.9)                                   */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="accounting-integrity">
            <Container width="full">
              <SectionHeader
                eyebrow="Accounting integrity"
                title="Whether the stock schedule agrees with the control accounts"
                lede="One figure at one comparison date. The full reconciliation, its four comparison states and the governed exceptions are on the accounting page."
              />
              <div className="pt-6">
                <ReconciliationSignal
                  signal={accountingSignal}
                  href={ROUTES.dashboardAccounting.href}
                />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* Lead funnel                                                     */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="lead-funnel">
            <Container width="full">
              <SectionHeader
                eyebrow="Lead funnel"
                title="Leads, contact, appointments and what closed"
                lede="Counted by lead-creation date, with only the governed conversion rates shown. Source quality, campaign cost and lost-stage analysis are the leads and marketing page, delivered by DASH.10."
              />
              <div className="pt-6">
                <LeadFunnel funnel={overview.funnel} comparisonLabel={comparisonLabel} />
              </div>
            </Container>
          </Section>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Trust and evidence                                                  */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="default" tone="evidence" id="trust">
        <Container width="full">
          <SectionHeader
            eyebrow="Trust and evidence"
            title="What this console has proved, and what it has not"
            lede="Two independent lanes. The export lane is checked by the exporter and the generator; the Power BI lane is read from the ADR-0008 evidence files and from nothing else."
          />
          <div className="pt-6">
            <TrustPanel exportState={exportState} powerBi={powerBi} />
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* What is not built                                                   */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="default" id="not-built">
        <Container width="full">
          <SectionHeader
            eyebrow="Delivery"
            title="What this console does not do yet"
            lede="Named rather than mocked. Every section below is absent because the warehouse entity, reporting view or rule engine behind it does not exist yet."
          />
          <div className="pt-6">
            <PlannedSections sections={PLANNED_DASHBOARD_SECTIONS} />
          </div>
        </Container>
      </Section>
    </Canvas>
  )
}

/* -------------------------------------------------------------------------- */
/* Control options                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The condition control's options, read from the export's declared enumeration.
 *
 * The URL grammar accepts `Certified` because `INFORMATION_ARCHITECTURE.md` §6 makes
 * it part of the console-wide vocabulary. The warehouse models New and Used only, so
 * the control does not offer a third value that cannot match a row.
 */
function conditionOptions(): readonly FilterOption[] {
  return dashboardConditionGroups.map((group) => ({ value: group, label: group }))
}

/**
 * The period presets, laid out on the server.
 *
 * Built here rather than inside the client island, so the island imports no
 * formatter and no calendar: these are eight strings that were known at build time.
 */
function periodOptions(overview: ExecutiveOverview): readonly FilterOption[] {
  const options: FilterOption[] = [
    { value: '', label: 'Latest full month (default)' },
    ...[...calendarMonths].reverse().map((month) => ({
      value: month,
      label: formatIsoMonth(month),
    })),
    {
      value: 'mtd',
      label: `Month to date (to ${formatIsoDate(overview.asOfDate)})`,
    },
    {
      value: 'last-30d',
      label: `Last 30 days (to ${formatIsoDate(overview.asOfDate)})`,
    },
  ]
  if (overview.filters.period.kind === 'range') {
    options.push({
      value: 'range',
      label: `Custom range (${overview.filters.period.start} to ${overview.filters.period.end})`,
    })
  }
  return options
}

function storeOptions(): readonly FilterOption[] {
  return dashboardStores.map((store) => ({
    value: store.id,
    label: `${store.shortName} (${store.id})`,
  }))
}

function leadSourceOptions(): readonly FilterOption[] {
  return dashboardLeadSources.map((source) => ({
    value: source.code,
    label: `${source.name} (${source.code})`,
  }))
}
