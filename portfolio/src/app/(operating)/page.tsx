import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Canvas } from '@/components/shell/field'
import {
  AttentionSummary,
  ChangeDriverBridge,
  TopActions,
} from '@/components/dashboard/actions-sections'
import { ActiveFilters, ContextProvenance } from '@/components/dashboard/context-rail'
import { GridRow, Module, Workspace } from '@/components/dashboard/workspace-grid'
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
import { Container, Section } from '@/components/ui/layout'
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
import { DOMAIN_LABELS, SEVERITY_LABELS } from '@/lib/dashboard/action-contract'
import {
  NO_FACETS,
  buildActionQueue,
  selectActions,
  topActions,
} from '@/lib/dashboard/actions'
import { managementActions } from '@/lib/dashboard/actions-data'
import { buildBridge, buildChangeDrivers } from '@/lib/dashboard/change-drivers'
import { grossChangeBridgeRows } from '@/lib/dashboard/change-drivers-data'
import { parseFilters, type QueryInput } from '@/lib/dashboard/filters'
import { formatIsoDate, formatIsoMonth } from '@/lib/dashboard/format'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { PLANNED_DASHBOARD_SECTIONS, ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('home')

const ROUTE = ROUTES.home.href

/**
 * The ARPI Executive Command Center.
 *
 * A WORKSPACE, NOT A DOCUMENT WITH CHARTS IN IT
 * ---------------------------------------------
 * `UX.1` fixed the product architecture and left the visual product as five stacked
 * full-width bands. Measured on the merge of `DASH.12`, at 1440 × 900: the first framed
 * visualization began 1,389 px down, and the first viewport contained ZERO data-driven
 * visual regions — a control band, a notice stack, a filter form and the top edge of the
 * KPI cards. Every figure was present and the reader had to scroll to meet any of them.
 * The numbers are in `docs/reviews/UX-2-BASELINE.md`.
 *
 * `UX.2A` rebuilds the surface as a twelve-column grid of MODULES: titled panels, several
 * across, each holding one question. The region eyebrows, the region `h2`s and most of the
 * region ledes are gone, because a module's own title says what it holds and
 * `Group performance` above four modules that each say so was the page talking to itself.
 *
 * THE FIRST VIEWPORT CONTRACT (`UX.2A` §4)
 * ----------------------------------------
 * At 1440 × 900, before any scrolling, a general manager meets: the control band; the
 * eight-card KPI rail, whole; and three modules of data-driven geometry — the primary
 * operating trend, the store comparison and the plan/pace bullets. Every module whose body
 * is geometry carries `data-visual-region`, so the contract is asserted by MEASUREMENT
 * rather than by eye: `tests/e2e/executive-workspace.spec.ts` reads their offsets against
 * the viewport, and re-reads them under three different filter states so the layout cannot
 * meet its contract by coincidence on the default query.
 *
 * WHAT DID NOT CHANGE, AND THIS IS THE LOAD-BEARING SENTENCE
 * ----------------------------------------------------------
 * No KPI definition, no denominator, no date basis, no structural-absence rule, no
 * accounting semantic, no bridge arithmetic and no action rule. Every figure on this page
 * comes from the same governed selector it came from before, through
 * `buildExecutiveOverview()`, evaluated on the server. `UX.2A` is a presentation increment
 * and the calculation authority is exactly where it was.
 *
 * STILL A SERVER COMPONENT, AND STILL ONE CLIENT ISLAND
 * ----------------------------------------------------
 * Every figure, table, funnel, chart and disclosure is rendered on the server from a
 * build-packaged export. One client island exists — the filter controls — and it receives
 * five option lists and no data. The trend's metric switch, which `UX.2A` §7 asks for, is a
 * radio group and CSS: it ships no JavaScript, it works with scripting off, and it cannot
 * recalculate anything because there is no code in it. With scripting disabled the rail and
 * its microtrends, the trend, the store comparison, the pace bullets, the age-and-capital
 * stack, the funnel, the gross compositions, the attention queue, the change bridge, the
 * reconciliation scale and every disclosure are all present, and the filter form degrades to
 * the native GET submission it already is.
 *
 * WHY IT READS `searchParams` — filter state lives in the URL and nowhere else, so this
 * route is rendered per request. There is no database behind that request: the data was
 * packaged at build time and the "query" is an array pass over it.
 *
 * WHY THE DETAIL MODULES STAY SUMMARIES — `/dashboard/inventory` and
 * `/dashboard/accounting` own the unit-level and account-level detail. The stock and
 * integrity modules link to them rather than reproduce them, and that is a payload decision
 * as much as an editorial one: the two detail routes read 356 kB and 360 kB of per-unit
 * chunks that this route is forbidden to open, and `dashboard-boundaries.test.ts` fails the
 * build if it ever does.
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

  /*
   * The attention queue, scoped to the reader's STORE filter and to nothing else.
   *
   * `UX.2A` §13 asks the Executive to carry the queue's shape as well as its first rows,
   * and a count that ignored the store filter would disagree with every other figure on the
   * screen. The store facet is the only one of the four that the console-wide filter
   * grammar can express; severity, domain and review role are the Action Center's own
   * parameters and stay there. `buildActionQueue` is the same function `/dashboard/actions`
   * calls, over the same rows, so the two surfaces cannot report different counts.
   */
  const attentionFacets = { ...NO_FACETS, store: parsed.filters.store }
  /*
   * The queue is NARROWED FIRST and then tallied, rather than tallied and then narrowed.
   *
   * `buildActionQueue` deliberately computes its facet counts over the whole queue, because
   * on `/dashboard/actions` a count that fell to zero the moment its own facet was selected
   * would tell a reader nothing about what selecting a different value would show them.
   * Here the question is the opposite one — how many prompts exist IN THE SCOPE the rest of
   * the screen is showing — so the store filter is applied to the rows and the tally is
   * taken over what is left. The first version passed the store facet into the tally
   * instead, which left `total` counting the whole group under a label that said "in
   * scope": correct arithmetic, wrong population, and wrong in the direction that flatters.
   */
  const attentionQueue = buildActionQueue(
    selectActions(managementActions(), attentionFacets),
    NO_FACETS,
    Object.fromEntries(dashboardStores.map((store) => [store.id, store.shortName])),
    DOMAIN_LABELS,
    SEVERITY_LABELS
  )

  /*
   * The change-driver decomposition, built from the SAME bridge module
   * `/dashboard/sales-gross` and `/dashboard/actions` use. One authority, three
   * presentations: this one groups effects below the configured materiality into a labelled
   * remainder, which the detail page deliberately does not, because a page devoted to the
   * bridge should show all of it.
   *
   * The store scope follows the reader's filter so the bridge agrees with the KPI rail above
   * it; the month is the export's as-of month, because a bridge compares one whole month
   * with the one before it and the filter's period may be neither.
   */
  const executiveDrivers = buildChangeDrivers(
    buildBridge(
      grossChangeBridgeRows(),
      parsed.filters.store.length > 0
        ? parsed.filters.store
        : dashboardStores.map((store) => store.id),
      dashboardManifest.asOfDate.slice(0, 7)
    ),
    {
      value: dashboardManifest.actions.changeDrivers.materiality.value,
      label: dashboardManifest.actions.changeDrivers.materiality.label,
    }
  )

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
        <Workspace>
          {/* ---------------------------------------------------------------- */}
          {/* ROW 1 — the rail                                                  */}
          {/* ---------------------------------------------------------------- */}
          {/*
            The rail is a module like any other, and its title is the one region name that
            survived: eight figures in two ranks need a name, and "Group result" is what a
            manager calls them. The colour rule is one line, and it earns its place because
            this surface uses colour — a reader who sees green on a pace bullet is owed the
            rule that produced it, once, before the figures.
          */}
          <GridRow>
            <Module
              id="group-performance"
              title="Group result"
              zone="performance"
              visual="kpi-rail"
              note="Colour marks sign, a met target and unit age. Nothing else."
              meta={overview.periodContext.period.label}
            >
              <KpiStrip
                cards={overview.cards}
                comparisonLabel={comparisonLabel}
                comparisonUnavailable={overview.periodContext.comparisonUnavailable}
              />
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 2 — the three modules the viewport contract is measured on    */}
          {/* ---------------------------------------------------------------- */}
          {/*
            THIS ROW IS WHY THE CONTRACT HOLDS. `UX.2A` §4 asks for at least three
            data-driven visual regions inside 1440 × 900, and the rail above is separately
            required, so the three have to be here. Trend, stores and pace are also the
            right three on the merits: the shape, whose it is, and where the month sits
            against what was committed. Everything below this row is a follow-up question.
          */}
          <GridRow>
            <Module
              id="operating-trend"
              title="Operating trend"
              span={6}
              zone="performance"
              visual="trend"
              meta="Trailing months, anchored on the selection"
            >
              <OperatingTrend trend={overview.trend} />
            </Module>
            <Module
              id="store-comparison"
              title="Stores"
              span={3}
              zone="performance"
              visual="store-comparison"
            >
              <StoreComparisonSection overview={overview} />
            </Module>
            <Module
              id="targets"
              title="Plan and pace"
              span={3}
              zone="plan"
              visual="pace"
              note="The projection is selling-day arithmetic, not a forecast. Targets are synthetic operating goals, not benchmarks."
            >
              <TargetPaceSection context={overview.targets} headingLevel="h4" />
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 3 — stock, demand, gross                                      */}
          {/* ---------------------------------------------------------------- */}
          <GridRow>
            <Module
              id="inventory-exposure"
              title="Inventory exposure"
              span={5}
              zone="inventory"
              visual="inventory"
            >
              <InventoryRisk
                inventory={overview.inventory}
                comparisonLabel={comparisonLabel}
              />
            </Module>
            <Module
              id="composition"
              title="Lead funnel"
              span={4}
              zone="funnel"
              visual="funnel"
            >
              <LeadFunnel
                funnel={overview.funnel}
                comparisonLabel={comparisonLabel}
                filters={parsed.filters}
              />
            </Module>
            <Module
              id="gross-composition"
              title="Gross composition"
              span={3}
              zone="performance"
              visual="gross"
            >
              <SalesAndGross salesGross={overview.salesGross} />
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 4 — attribution and attention                                 */}
          {/* ---------------------------------------------------------------- */}
          <GridRow>
            <Module
              id="change-drivers"
              title="What the bridge attributes the change to"
              span={7}
              visual="change-drivers"
            >
              <ChangeDriverBridge
                drivers={executiveDrivers}
                authority={dashboardManifest.actions.changeDrivers.authority}
              />
            </Module>
            <Module
              id="management-attention"
              title="Management attention"
              span={5}
              visual="attention"
              note="Deterministic prompts from rules written down in advance. A reason to look, not a finding, a recommendation or a claim about cause."
            >
              <AttentionSummary view={attentionQueue} facets={attentionFacets} />
              <TopActions
                actions={topActions(attentionQueue.actions, 4)}
                total={attentionQueue.total}
                href={ROUTES.dashboardActions.href}
              />
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 5 — integrity, and the detail on demand                       */}
          {/* ---------------------------------------------------------------- */}
          {/*
            `DASH.9` landed the reconciliation view model, its tests and the narrow data
            door, and recorded in `accounting-data.ts` that the 43-row comparison set "IS
            the Executive summary" for this route. This module is that summary. It reads the
            comparison set and nothing else: the 360 kB of per-unit book values in
            `accounting-chunks.ts` belong to `/dashboard/accounting`, and a reader who wants
            them follows the drill-through rather than paying for them here.
          */}
          <GridRow>
            <Module
              id="accounting-integrity"
              title="Whether the books agree"
              span={7}
              visual="accounting"
              note="A variance between the stock schedule and the general ledger is a finding to investigate, not a broken record, and both sides are valid data."
            >
              <ReconciliationSection signal={accountingSignal} />
            </Module>
            <Module id="detail" title="Detail, on demand" span={5}>
              {/*
                THE SCOREBOARD AND THE BACKLOG ARE DISCLOSURES, and both are still in the
                document. `<details>` collapses a body of detail visually while leaving it
                in the accessibility tree's reading order and in a browser text search,
                which is the same technique every chart on this page uses for its data
                table. The scoreboard is ten columns of table; the backlog is the list of
                what is not built. Both are things a reader goes looking for, and neither is
                what an operating console opens with.
              */}
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

              {/*
                THE TRUST DISCLOSURE IS NOT HERE AND HAS NOT MOVED SINCE `UX.1`. It is the
                control band's `methodology` panel — same `<details>`, same `<TrustPanel>`,
                same full synthetic statement, beside the filters rather than at the foot of
                the page. What is gone is the SECOND copy: a disclosure stated twice on one
                document is not twice as honest.
              */}
              <ConsoleDisclosure id="not-built" summary="What is not built yet">
                <PlannedSections sections={PLANNED_DASHBOARD_SECTIONS} />
              </ConsoleDisclosure>
            </Module>
          </GridRow>
        </Workspace>
      )}

      {/*
        THE EVIDENCE MODULES RENDER WHEN THE FILTER MATCHES NOTHING, and the two disclosures
        that can still answer keep answering. A reader whose filter returned no rows is the
        reader most likely to be asking what the data is and how far it has been proved.
        Only the parts that need matching rows stand down.
      */}
      {overview.empty ? (
        <Workspace>
          <GridRow>
            <Module id="detail" title="Detail, on demand" span={12}>
              <ConsoleDisclosure id="not-built" summary="What is not built yet">
                <PlannedSections sections={PLANNED_DASHBOARD_SECTIONS} />
              </ConsoleDisclosure>
            </Module>
          </GridRow>
        </Workspace>
      ) : null}
    </Canvas>
  )
}

/* -------------------------------------------------------------------------- */
/* Disclosures                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A body of detail, collapsed but not removed.
 *
 * THE `id` STAYS ON THE ELEMENT. Both of these were page regions with anchors that in-page
 * navigation and external links point at, and an anchor that stops resolving is a broken
 * link even when the content is still on the page.
 *
 * `note` is the one sentence a reader needs BEFORE deciding to open it. Where opening is
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
      <summary className="flex min-h-touch cursor-pointer items-center px-3 text-sm font-medium text-ink-secondary transition-colors duration-(--arpi-motion-fast) hover:text-accent">
        {summary}
      </summary>
      <div className="flex flex-col gap-4 px-3 pb-4">
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

/* -------------------------------------------------------------------------- */
/* Control options                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The condition control's options, read from the export's declared enumeration.
 *
 * The URL grammar accepts `Certified` because `INFORMATION_ARCHITECTURE.md` §6 makes it
 * part of the console-wide vocabulary. The warehouse models New and Used only, so the
 * control does not offer a third value that cannot match a row.
 */
function conditionOptions(): readonly FilterOption[] {
  return dashboardConditionGroups.map((group) => ({ value: group, label: group }))
}

/**
 * The period presets, laid out on the server.
 *
 * Built here rather than inside the client island, so the island imports no formatter and
 * no calendar: these are eight strings that were known at build time.
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
