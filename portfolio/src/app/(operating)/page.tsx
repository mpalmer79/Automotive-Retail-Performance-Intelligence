import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Canvas } from '@/components/shell/field'
import { ActiveFilters, ContextProvenance } from '@/components/dashboard/context-rail'
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
import {
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import { StoreScoreboard } from '@/components/dashboard/store-scoreboard'
import { TargetPaceSection } from '@/components/dashboard/target-context'
import { TrustPanel } from '@/components/dashboard/trust-panel'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
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
import { PLANNED_DASHBOARD_SECTIONS, ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('home')

const ROUTE = ROUTES.home.href

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
 * FIVE REGIONS, NOT NINE SECTIONS
 * -------------------------------
 * The console once ran as nine independently-padded page sections, each opening with a
 * paragraph. That is the rhythm of a documentation route, and this is not one: a reader
 * arrived at roughly a thousand words of prose before the first comparison they could
 * make by eye. It then ran as seven rows, which was better and still one region per
 * component rather than one region per question. It now runs as FIVE, and each is a
 * question a general manager actually asks:
 *
 *   CONTROL      what am I looking at, and how do I change it
 *   PERFORMANCE  how did the group do, over what shape, and which store is different
 *   PLAN & STOCK where is the month against plan, and what is standing on the lot
 *   DEMAND       what produced the units, and what the gross was made of
 *   INTEGRITY    whether the ledger agrees, and everything the console can prove
 *
 * Every figure that was on the page is still on the page. What moved is prose, and
 * where it moved to is stated at each call site. Three bodies of detail -- the ten-column
 * scoreboard, the trust evidence, and the list of what is not built -- are now behind
 * disclosures. `<details>` keeps them in the document, in the accessibility tree and in
 * a browser text search, so nothing was removed from the page; it stopped being the
 * first thing on it.
 *
 * A REGION IS TINTED BY BUSINESS AREA, NEVER BY STATE
 * --------------------------------------------------
 * Each data region carries a restrained `zone-*` wash so the eye can find an area on a
 * long page. A wash encodes nothing: the stock region is amber whether the lot is clean
 * or ageing badly. No `zone-*` token is a `data-*` token, so a tint cannot be read as a
 * value.
 *
 * WHY THE DETAIL REGIONS STAY SUMMARIES
 * -------------------------------------
 * `DASH.9` built `/dashboard/inventory` and `/dashboard/accounting`, which own the
 * unit-level and account-level detail. The stock and integrity regions link to them
 * rather than reproduce them, and that is a payload decision as much as an editorial
 * one: the two detail routes read 356 kB and 360 kB of per-unit chunks that this route
 * is forbidden to open, and `dashboard-boundaries.test.ts` fails the build if it ever
 * does. A summary with a link costs one anchor; a summary that copies its destination
 * costs the destination's data.
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
      <OperatingPageHeader
        title="Executive"
        context={operatingContext([
          overview.scope.label,
          overview.periodContext.period.label,
          /* A comparison that could not be resolved says so on the line rather
             than printing the mode as though it had been applied. The reason is
             in the period notice directly below. */
          comparisonLabel === null
            ? overview.periodContext.comparisonUnavailable === null
              ? overview.periodContext.comparisonLabel
              : `${overview.periodContext.comparisonLabel} unavailable`
            : `vs ${comparisonLabel}`,
        ])}
        notices={
          <div className="flex flex-col gap-4 empty:hidden">
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={failedReconciliation} />
            <FilterNotice resets={overview.resets} resetHref={ROUTE} />
            <PeriodNotice notices={overview.periodContext.notices} />
            <ActiveFilters overview={overview} route={ROUTE} />
          </div>
        }
        filters={
          <FilterBar
            action={ROUTE}
            filters={overview.filters}
            periodOptions={periodOptions(overview)}
            stores={storeOptions()}
            conditions={conditionOptions()}
            leadSources={leadSourceOptions()}
          />
        }
        methodologyId="trust"
        methodology={
          <>
            <TrustPanel exportState={exportState} powerBi={powerBi} />
            <ContextProvenance
              overview={overview}
              route={ROUTE}
              datasetVersion={exportState.datasetVersion}
              contractFingerprint={exportState.contractFingerprint}
            />
          </>
        }
      />

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
          {/* REGION 2 — Performance                                          */}
          {/* -------------------------------------------------------------- */}
          {/*
            The KPI row, the trailing trend and the three stores were three regions,
            each with its own heading, eyebrow and paragraph. They are one question --
            how did the group do -- read at three grains: the figure, its shape, and
            whose it is. Merging them removes two headings and two paragraphs and puts
            the store comparison inside the same eyeline as the figure it decomposes.

            The one surviving sentence is the COLOUR LEGEND, and it earns its place
            precisely because this pass added colour. A reader who sees green on the
            pace bar is owed the rule that produced it, once, before the figures.
          */}
          <ConsoleRow
            id="group-performance"
            zone="performance"
            eyebrow="Group performance"
            title="Result, shape and store contribution"
            lede="No measure here has a governed favourable direction. Colour marks three things only: which side of zero a value falls, whether an explicit target was met, and how old a unit is."
          >
            <div className="flex flex-col gap-12">
              <KpiStrip
                cards={overview.cards}
                comparisonLabel={comparisonLabel}
                comparisonUnavailable={overview.periodContext.comparisonUnavailable}
              />
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
            </div>
          </ConsoleRow>

          {/* -------------------------------------------------------------- */}
          {/* REGION 3 — Plan and stock                                       */}
          {/* -------------------------------------------------------------- */}
          {/*
            Pace is secondary to the figures above it, and deliberately so: the actual is
            the business result and the plan is the management context beside it. Nothing
            here is a forecast — the projected figure is arithmetic over the governed
            selling-day calendar and carries that name wherever it appears.

            The lede kept only the two claims a reader would MISREAD the figures without.
            The aged threshold sentence left it because the age stack now prints the
            threshold on itself, where the colour ramp turns on it.
          */}
          <ConsoleRow
            id="targets"
            zone="plan"
            eyebrow="Plan and stock"
            title="Pace against plan, and what is on the lot"
            lede="The projection is arithmetic over the selling-day calendar rather than a forecast, and the targets are synthetic operating goals rather than benchmarks."
          >
            <div className="grid gap-x-10 gap-y-12 xl:grid-cols-12">
              <div className="xl:col-span-5">
                <Pane title="Targets and pace">
                  <TargetPaceSection context={overview.targets} />
                </Pane>
              </div>
              {/* The stock area carries its own tint inside the plan region: two
                  business areas share this row, and the boundary between them is
                  otherwise carried only by a column gap that closes below `xl`. */}
              <div className="rounded-2xl bg-zone-inventory p-5 xl:col-span-7">
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
          {/* REGION 4 — Demand and gross                                     */}
          {/* -------------------------------------------------------------- */}
          {/*
            No lede. The old one described what the two panes contain, which their own
            headings already do, and then pointed at `/dashboard/leads-marketing` --
            which is a link, and is now rendered as one.
          */}
          <ConsoleRow
            id="composition"
            zone="funnel"
            eyebrow="Demand and gross"
            title="What produced the units, and what the gross was made of"
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
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* REGION 5 — Integrity and evidence                                   */}
      {/* ------------------------------------------------------------------ */}
      {/*
        `DASH.9` landed the reconciliation view model, its tests and the narrow data
        door, and recorded in `accounting-data.ts` that the 43-row comparison set "IS
        the Executive summary" for this route. This region is that summary. It reads the
        comparison set and nothing else: the 360 kB of per-unit book values in
        `accounting-chunks.ts` belong to `/dashboard/accounting`, and a reader who wants
        them follows the drill-through this section carries rather than paying for them
        here. The figure comes from `buildAccountingSignal()`, which is the only function
        in the console that resolves a comparison date, applies the store filter and
        totals a signed variance. Neither this pass nor the one before it replaced,
        re-implemented or reinterpreted any accounting semantics underneath it.

        THE SCOREBOARD, THE EVIDENCE AND THE BACKLOG ARE NOW DISCLOSURES, and each one
        is still in the document. `<details>` collapses a region visually while leaving
        it in the accessibility tree's reading order and in a browser text search, which
        is the same technique every chart on this page uses for its data table. The
        scoreboard was ten columns of table opening a region; the trust panel and the
        synthetic statement were a full region of provenance; the backlog was a region
        headed "What this console does not do yet". All three are things a reader goes
        looking for, and none of them is what an operating console opens with.
      */}
      {/*
        THE REGION RENDERS WHEN THE FILTER MATCHES NOTHING, and the two disclosures that
        can still answer keep answering. A reader whose filter returned no rows is the
        reader most likely to be asking what the data is and how far it has been proved.
        Only the two parts that need matching rows -- the reconciliation and the
        scoreboard -- stand down.
      */}
      <ConsoleRow
        id="accounting-integrity"
        tone="evidence"
        eyebrow="Integrity"
        title="Whether the books agree"
        lede={
          overview.empty
            ? undefined
            : 'A variance between the stock schedule and the general ledger is a finding to investigate, not a broken record, and both sides are valid data.'
        }
      >
        <div className="flex flex-col gap-8">
          {overview.empty ? null : <ReconciliationSection signal={accountingSignal} />}

          <div
            className={
              overview.empty
                ? 'flex flex-col gap-3'
                : 'flex flex-col gap-3 border-t border-line pt-8'
            }
          >
            {overview.empty ? null : (
              <ConsoleDisclosure
                id="store-scoreboard"
                summary="Every governed column, for every store in scope"
                note="Three operating models side by side and not ranked. A cell a store cannot have reads Not applicable rather than zero, because a zero in a performance column is read as performance."
              >
                <StoreScoreboard
                  rows={overview.scoreboard}
                  columns={SCOREBOARD_COLUMNS}
                  caption={`Store scoreboard for ${overview.periodContext.period.label}`}
                />
              </ConsoleDisclosure>
            )}

            {/*
              THE TRUST DISCLOSURE MOVED UP, NOT AWAY. It is the control band's
              `methodology` panel now — same `<details>`, same `<TrustPanel>`, same
              full synthetic statement, one screen higher and beside the filters
              rather than at the foot of a five-region page. What is gone is the
              SECOND copy: it was rendered here and in the page header's trust line,
              and a disclosure stated twice on one document is not twice as honest.
            */}
            <ConsoleDisclosure id="not-built" summary="What is not built yet">
              <PlannedSections sections={PLANNED_DASHBOARD_SECTIONS} />
            </ConsoleDisclosure>
          </div>
        </div>
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
const ZONE_WASH: Readonly<
  Record<'performance' | 'plan' | 'inventory' | 'funnel', string>
> = {
  performance: 'bg-zone-performance',
  plan: 'bg-zone-plan',
  inventory: 'bg-zone-inventory',
  funnel: 'bg-zone-funnel',
}

/**
 * A body of detail, collapsed but not removed.
 *
 * WHY `<details>` AND NOT A LINK OR A TAB. The scoreboard, the trust evidence and the
 * backlog stay in the document: in the accessibility tree's reading order, in a browser
 * text search, in the printed page and in the no-JavaScript rendering. Collapsing them
 * costs a reader one click and costs the page nothing, which is the trade a tab panel
 * and a second route both fail. It is the same technique every chart on this console
 * already uses for its data table.
 *
 * THE `id` STAYS ON THE ELEMENT. Three of these were regions with anchors that the
 * in-page navigation and external links point at, and an anchor that stops resolving is
 * a broken link even when the content is still on the page.
 *
 * `note` is the one sentence a reader needs BEFORE deciding to open it -- the
 * scoreboard's not-applicable rule, the two independent trust lanes. Where opening is
 * self-explanatory there is no note.
 */
function ConsoleDisclosure({
  id,
  summary,
  note,
  children,
}: {
  readonly id: string
  readonly summary: string
  readonly note?: string
  readonly children: ReactNode
}) {
  return (
    <details
      id={id}
      className="rounded-xl border border-line-subtle bg-surface-sunken/40"
    >
      <summary className="flex min-h-touch cursor-pointer items-center px-4 text-sm font-medium text-ink-secondary transition-colors duration-(--arpi-motion-fast) hover:text-accent">
        {summary}
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-5">
        {note === undefined ? null : (
          <Text size="xs" tone="faint" className="max-w-prose">
            {note}
          </Text>
        )}
        {children}
      </div>
    </details>
  )
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
