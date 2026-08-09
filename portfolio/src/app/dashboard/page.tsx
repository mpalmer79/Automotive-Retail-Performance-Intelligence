import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Canvas } from '@/components/shell/field'
import { ContextRail } from '@/components/dashboard/context-rail'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { InventoryRisk } from '@/components/dashboard/inventory-risk'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { LeadFunnel } from '@/components/dashboard/lead-funnel'
import { OperatingTrend, StoreComparisonSection } from '@/components/dashboard/operating'
import { ReconciliationSection } from '@/components/dashboard/reconciliation'
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
import { Heading, Text } from '@/components/ui/typography'
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
 * Every figure, table, funnel, chart and disclosure on this page is rendered on the
 * server from a build-packaged export. One client island exists — the filter
 * controls — and it receives five option lists and no data. That is what makes the
 * no-JavaScript guarantee real rather than aspirational: with scripting disabled
 * the KPI row and its microtrends, the operating trend, the store comparison, the
 * scoreboard, the inventory stack, the funnel, the reconciliation scale, the trust
 * panel and the synthetic disclosure are all present, and the filter form degrades to
 * a native GET submission because that is what it already is.
 *
 * The nine visualisations added by the visual overhaul contribute **zero bytes of
 * client JavaScript**, which is the measured result recorded in `DESIGN_SYSTEM.md`
 * §6.0b and `PERFORMANCE.md` §9.8, and the reason there is still no chart library here.
 *
 * WHY IT READS `searchParams`
 * ---------------------------
 * Filter state lives in the URL and nowhere else, so this route is rendered per
 * request. There is no database behind that request: the data was packaged at
 * build time and the "query" is an array pass over it.
 *
 * SEVEN ROWS, NOT NINE SECTIONS
 * -----------------------------
 * The console previously ran as nine independently-padded page sections, each opening
 * with a paragraph. That is the rhythm of a documentation route, and this is not one: a
 * reader arrived at roughly a thousand words of prose before the first comparison they
 * could make by eye, and only three pieces of the page carried any data-driven geometry
 * at all. It now runs as seven rows on a twelve-column console grid, and the reading
 * order they produce is the one an operating console is for:
 *
 *   SEE          row 2, seven governed figures each carrying its own shape
 *   COMPARE      row 3, the period's trend beside the three stores
 *   INVESTIGATE  rows 4-6, pace against plan, ageing, composition, funnel, integrity
 *   READ DETAILS row 7, the ten-column scoreboard, the evidence, what is not built
 *
 * Every figure that was on the page is still on the page. What moved is prose, and
 * where it moved to is stated at each call site.
 *
 * WHY THE INVESTIGATE ROWS STAY SUMMARIES
 * ---------------------------------------
 * `DASH.9` built `/dashboard/inventory` and `/dashboard/accounting`, which own the
 * unit-level and account-level detail. Rows 4 and 6 link to them rather than reproduce
 * them, and that is a payload decision as much as an editorial one: the two detail
 * routes read 356 kB and 360 kB of per-unit chunks that this route is forbidden to
 * open, and `dashboard-boundaries.test.ts` fails the build if it ever does. A summary
 * with a link costs one anchor; a summary that copies its destination costs the
 * destination's data.
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
        lede={`Retail volume, gross and gross per retail unit, target pace, inventory risk, the lead funnel and accounting integrity for ${overview.scope.label.toLowerCase()}, over ${overview.periodContext.period.label}. Every figure is read from a governed SQL export and reconciles to it exactly.`}
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
      {/* ROW 1 — Context and control                                         */}
      {/* ------------------------------------------------------------------ */}
      {/*
        The full synthetic statement used to sit here, above the figures. It is now in
        row 7 with the rest of the evidence: the compact form is already in the page
        header's trust line, and thirty words of provenance between a reader and the KPI
        row is thirty words in the wrong place. Nothing about it was softened or removed.
      */}
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
          {/* ROW 2 — Headline instrumentation                                */}
          {/* -------------------------------------------------------------- */}
          <ConsoleRow
            id="group-performance"
            eyebrow="Group performance"
            title="The seven figures the group is run on"
            lede="Each card carries its governed KPI, the difference against the comparison period, and its own shape over the trailing months. Direction is stated in neutral words: this console has no governed favourable direction for these measures."
          >
            <KpiStrip
              cards={overview.cards}
              comparisonLabel={comparisonLabel}
              comparisonUnavailable={overview.periodContext.comparisonUnavailable}
            />
          </ConsoleRow>

          {/* -------------------------------------------------------------- */}
          {/* ROW 3 — Operating trend and store comparison                    */}
          {/* -------------------------------------------------------------- */}
          <ConsoleRow
            id="operating"
            tone="evidence"
            eyebrow="Operating shape"
            title="What has been happening, and to whom"
            lede="The trailing months ending with the selected period, beside the same period's stores. Both are drawn from the governed selectors the scoreboard uses."
          >
            <div className="grid gap-x-10 gap-y-12 xl:grid-cols-12">
              <div className="xl:col-span-7">
                <Pane title="Trend">
                  <OperatingTrend trend={overview.trend} />
                </Pane>
              </div>
              <div className="xl:col-span-5">
                <Pane title="Stores">
                  <StoreComparisonSection overview={overview} />
                </Pane>
              </div>
            </div>
          </ConsoleRow>

          {/* -------------------------------------------------------------- */}
          {/* ROW 4 — Target pace and inventory ageing                        */}
          {/* -------------------------------------------------------------- */}
          {/*
            Pace is secondary to the KPI row above it, and deliberately so: the actual is
            the business result and the plan is the management context beside it. Nothing
            here is a forecast — the projected figure is arithmetic over the governed
            selling-day calendar and carries that name wherever it appears.
          */}
          <ConsoleRow
            id="targets"
            eyebrow="Plan and stock"
            title="Where the month is against plan, and what is standing on the lot"
            lede="Actual against target with the selling-day clock, beside the age profile at the latest snapshot in the period. The projection is linear arithmetic over the governed selling-day calendar, never a forecast, and the targets are synthetic operating goals rather than benchmarks."
          >
            <div className="grid gap-x-10 gap-y-12 xl:grid-cols-12">
              <div className="xl:col-span-5">
                <Pane title="Targets and pace">
                  <TargetPaceSection context={overview.targets} />
                </Pane>
              </div>
              <div className="xl:col-span-7">
                <Pane title="Inventory">
                  <InventoryRisk
                    inventory={overview.inventory}
                    comparisonLabel={comparisonLabel}
                  />
                </Pane>
              </div>
            </div>
          </ConsoleRow>

          {/* -------------------------------------------------------------- */}
          {/* ROW 5 — Gross composition and the lead funnel                   */}
          {/* -------------------------------------------------------------- */}
          <ConsoleRow
            id="composition"
            tone="evidence"
            eyebrow="Where it came from"
            title="The composition of the gross, and the funnel that produced the units"
            lede="Front against back and new against used, beside the five governed funnel stages. Source quality, campaign cost and lost-stage analysis are the leads and marketing page, delivered by DASH.10."
          >
            <div className="grid gap-x-10 gap-y-12 xl:grid-cols-12">
              <div className="xl:col-span-7">
                <Pane title="Sales and gross">
                  <SalesAndGross
                    salesGross={overview.salesGross}
                    comparisonLabel={comparisonLabel}
                  />
                </Pane>
              </div>
              <div className="xl:col-span-5">
                <Pane title="Lead funnel">
                  <LeadFunnel
                    funnel={overview.funnel}
                    comparisonLabel={comparisonLabel}
                    filters={parsed.filters}
                  />
                </Pane>
              </div>
            </div>
          </ConsoleRow>

          {/* -------------------------------------------------------------- */}
          {/* ROW 6 — Accounting integrity                                    */}
          {/* -------------------------------------------------------------- */}
          {/*
            `DASH.9` landed the reconciliation view model, its tests and the narrow data
            door, and recorded in `accounting-data.ts` that the 43-row comparison set "IS
            the Executive summary" for this route. This row is that summary. It reads the
            comparison set and nothing else: the 360 kB of per-unit book values in
            `accounting-chunks.ts` belong to `/dashboard/accounting`, and a reader who
            wants them follows the drill-through this section carries rather than paying
            for them here.

            The figure comes from `buildAccountingSignal()`, which is the only function in
            the console that resolves a comparison date, applies the store filter and
            totals a signed variance. The visual overhaul replaced the four-card
            presentation `DASH.9` shipped; it did not replace, re-implement or reinterpret
            any of the accounting semantics underneath it.
          */}
          <ConsoleRow
            id="accounting-integrity"
            eyebrow="Accounting integrity"
            title="Whether the stock schedule and the general ledger agree"
            lede="One position at the last month end inside the selected period. A variance is a finding to investigate, not a broken record, and both sides are valid data."
          >
            <ReconciliationSection signal={accountingSignal} />
          </ConsoleRow>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* ROW 7 — Detail, evidence and delivery                               */}
      {/* ------------------------------------------------------------------ */}
      {overview.empty ? null : (
        <ConsoleRow
          id="store-scoreboard"
          tone="evidence"
          eyebrow="Store scoreboard"
          title="Three operating models, side by side and not ranked"
          lede="Every governed column for every store in scope. Cells a store cannot have read Not applicable rather than zero, because a zero in a performance column is read as performance."
        >
          <StoreScoreboard
            rows={overview.scoreboard}
            columns={SCOREBOARD_COLUMNS}
            caption={`Store scoreboard for ${overview.periodContext.period.label}`}
          />
        </ConsoleRow>
      )}

      <ConsoleRow
        id="trust"
        eyebrow="Trust and evidence"
        title="What this console has proved, and what it has not"
        lede="Two independent lanes. The export lane is checked by the exporter and the generator; the Power BI lane is read from the ADR-0008 evidence files and from nothing else."
      >
        <div className="flex flex-col gap-8">
          <TrustPanel exportState={exportState} powerBi={powerBi} />
          {/* The full statement, moved here from above the KPI row. IA §8 puts the long
              form on the one page whose figures a reader is most likely to quote; it did
              not require that it come before them. */}
          <Text size="sm" tone="muted" className="max-w-prose border-t border-line pt-6">
            {SYNTHETIC_DATA_STATEMENT}
          </Text>
        </div>
      </ConsoleRow>

      <ConsoleRow
        id="not-built"
        tone="evidence"
        eyebrow="Delivery"
        title="What this console does not do yet"
        lede="Named rather than mocked. Every section below is absent because the warehouse entity, reporting view or rule engine behind it does not exist yet."
      >
        <PlannedSections sections={PLANNED_DASHBOARD_SECTIONS} />
      </ConsoleRow>
    </Canvas>
  )
}

/* -------------------------------------------------------------------------- */
/* The console grid                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One row of the operating console.
 *
 * `rhythm="tight"` rather than `default`, and that is the whole change to the page's
 * vertical rhythm. The default section rhythm is fluid to a large ceiling because it was
 * designed for documentation routes, where a section break is a change of subject and
 * wants the air. On a console every row is the same subject looked at from a different
 * angle, and nine default-rhythm sections produced most of a viewport height of empty
 * space between the figures a reader was trying to compare.
 *
 * `layout="wide"` on the header puts the one-line lede beside the heading instead of
 * under it, which is the other half of the same saving.
 *
 * THE LEDE IS OPTIONAL, AND ON THIS PAGE IT IS USUALLY ABSENT.
 * It was required, and requiring it is what made the console read like a report: every
 * region opened with a paragraph explaining what the reader was about to look at, and a
 * reader who has to be told what a chart shows before seeing it is looking at the wrong
 * chart. A lede now survives in exactly one place -- where a figure would be MISREAD
 * without it, such as the project-default aged threshold or the cohort basis of the
 * funnel. Everything else moved into the disclosure at the foot of the page or onto the
 * drill-through that owns the subject.
 */
function ConsoleRow({
  id,
  eyebrow,
  title,
  lede,
  tone = 'canvas',
  zone,
  children,
}: {
  readonly id: string
  readonly eyebrow: string
  readonly title: string
  /** Omit unless the figures below would be misread without it. */
  readonly lede?: string
  readonly tone?: 'canvas' | 'evidence'
  /**
   * A restrained domain tint behind the row.
   *
   * It helps the eye find a business area on a long page and encodes NO state: the
   * inventory zone is amber whether the lot is clean or ageing badly. Every wash is a
   * `zone-*` token, and none of them is a `data-*` token, so a tint can never be
   * mistaken for a value.
   */
  readonly zone?: 'performance' | 'plan' | 'inventory' | 'funnel'
  readonly children: ReactNode
}) {
  return (
    <Section
      rhythm="tight"
      tone={tone}
      id={id}
      className={zone === undefined ? undefined : ZONE_WASH[zone]}
    >
      <Container width="full">
        <SectionHeader eyebrow={eyebrow} title={title} lede={lede} layout="wide" />
        <div className={lede === undefined ? 'pt-6' : 'pt-8'}>{children}</div>
      </Container>
    </Section>
  )
}

/**
 * The domain tints, as class names rather than inline style.
 *
 * Written out in full because Tailwind scans source text for class names: a template
 * literal like `bg-zone-${zone}` produces no CSS at all, which is the kind of bug that
 * looks like a design decision.
 */
const ZONE_WASH: Readonly<Record<'performance' | 'plan' | 'inventory' | 'funnel', string>> = {
  performance: 'bg-zone-performance/35',
  plan: 'bg-zone-plan/35',
  inventory: 'bg-zone-inventory/30',
  funnel: 'bg-zone-funnel/35',
}

/**
 * A named pane inside a row.
 *
 * The heading is visually hidden. It exists so that two panes sharing a row are two
 * named regions in the accessibility tree rather than one undifferentiated run of
 * content — a screen-reader user moving by heading gets the same structure a sighted
 * reader gets from the column boundary, which is otherwise carried only by layout.
 */
function Pane({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <section aria-labelledby={`pane-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <Heading
        level={3}
        size="h6"
        id={`pane-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        className="sr-only"
      >
        {title}
      </Heading>
      {children}
    </section>
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
