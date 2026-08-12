import type { Metadata } from 'next'
import type { ReactNode } from 'react'

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
  DistributionSection,
  PerformanceGrid,
} from '@/components/dashboard/sales-gross-sections'
import {
  ConditionSplit,
  SaleTypeDetail,
  SalesRail,
  SalesTrend,
  StoreContribution,
} from '@/components/dashboard/sales-workspace'
import { GridRow, Module, Workspace } from '@/components/dashboard/workspace-grid'
import { GrossComposition } from '@/components/dashboard/visuals'
import { TargetPaceSection } from '@/components/dashboard/target-context'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import { Container, Section } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import {
  calendarMonths,
  dashboardConditionGroups,
  dashboardLeadSources,
  dashboardManifest,
  dashboardStores,
} from '@/lib/dashboard/data'
import { parseFilters, type QueryInput } from '@/lib/dashboard/filters'
import { formatIsoMonth } from '@/lib/dashboard/format'
import { operatingHref } from '@/lib/dashboard/navigation'
import { buildSalesGross, type MixBreakdown } from '@/lib/dashboard/sales-gross'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardSalesGross')

const ROUTE = ROUTES.dashboardSalesGross.href

/**
 * Sales and gross — the general sales manager's operating workspace.
 *
 * WHAT THIS ROUTE WAS, MEASURED, AND WHAT IT IS NOW
 * ------------------------------------------------
 * `docs/reviews/UX-2B-BASELINE.md` measured it on the merge of `UX.2A`: seven full-width
 * bands stacked down a 7,228 px document, each opening with an eyebrow, an `h2` and a lede.
 * At 1440 × 900 the first viewport contained an `h1`, an `h2` and nothing else — no figure,
 * no comparison, no shape. The first of the route's six framed figures began 2,752 px down,
 * and the gross-change bridge, which is the strongest analytical asset this surface has, was
 * the last thing on the page.
 *
 * `UX.2B` rebuilds it as the twelve-column module grid `UX.2A` established, in the order a
 * GSM actually reads: what happened, what shape it had, whose it was, what it was made of,
 * what the change decomposes into, and where the month sits against the plan. The region
 * eyebrows and the region `h2`s are gone — a module's own title says what it holds, and
 * `Mix` above a module titled `New and used` was the page talking to itself.
 *
 * THE FIRST-VIEWPORT CONTRACT (`UX.2B` §49)
 * -----------------------------------------
 * At 1440 × 900, before any scrolling: the control band; the nine-figure rail, whole; and
 * three modules of data-driven geometry — the primary trend, the store contribution and the
 * new/used split. Every module whose body is geometry carries `data-visual-region`, so the
 * contract is asserted by MEASUREMENT: `tests/e2e/dashboard-sales-gross.spec.ts` reads their
 * offsets against the viewport, under more than one filter state, so the layout cannot meet
 * its contract by coincidence on the default query.
 *
 * WHAT DID NOT CHANGE, AND THIS IS THE LOAD-BEARING SENTENCE
 * ----------------------------------------------------------
 * No KPI definition, no denominator, no date basis, no structural-absence rule and no bridge
 * arithmetic. Every figure comes from the same governed selector it came from before, through
 * `buildSalesGross()`, evaluated on the server. The one addition to the view model is a
 * per-segment gross per retail unit, which is `KPI-GRS-006` — the identity the rail already
 * publishes for the whole scope, and the store scoreboard on `/` has published per store
 * since `DASH.2` — evaluated over a narrower row set. Nothing was redefined.
 *
 * STILL A SERVER COMPONENT, STILL ONE CLIENT ISLAND. The filter bar receives option lists and
 * no data. The trend's measure switch is a radio group and CSS: it ships no JavaScript, it
 * works with scripting off, and it cannot recalculate anything because there is no code in
 * it. With scripting disabled the rail, the trend, both comparisons, the bridge, the
 * distribution, the composition, the pace bullets and every disclosure are all present.
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

  const conditionMix = mixById(view.mixes, 'condition')
  const storeMix = mixById(view.mixes, 'store')
  const saleTypeMix = mixById(view.mixes, 'sale-type')

  /*
   * The drill-through into the transactions, carrying the context (`UX.2B` §46, §47).
   *
   * `operatingHref` reduces the filter state to what the Deal Explorer can act on and
   * serializes it through the one canonical serializer, so a parameter the destination would
   * ignore is never appended and two equivalent states produce byte-identical URLs. The
   * comparison mode is dropped by that reduction, correctly: an index lists the deals in one
   * period and has no figure a comparison period could change.
   */
  const dealsHref = operatingHref(ROUTES.dashboardDeals.href, parsed.filters)

  const front = view.contribution.front
  const back = view.contribution.back
  const total = view.performance.find((metric) => metric.id === 'total-gross')?.figure
    .current

  return (
    <Canvas>
      <OperatingPageHeader
        title="Sales & Gross"
        context={operatingContext([
          view.scope.label,
          view.periodContext.period.label,
          comparisonLabel === null
            ? view.periodContext.comparisonUnavailable === null
              ? view.periodContext.comparisonLabel
              : `${view.periodContext.comparisonLabel} unavailable`
            : `vs ${comparisonLabel}`,
        ])}
        notices={
          <div className="flex flex-col gap-4 empty:hidden">
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={failedReconciliation} />
            <FilterNotice resets={parsed.reset} resetHref={ROUTE} />
            <PeriodNotice notices={view.periodContext.notices} />
          </div>
        }
        chips={view.chips}
        filterState={parsed.filters}
        route={ROUTE}
        filters={
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
        }
        methodology={
          <ExportProvenance
            exportState={exportState}
            powerBi={powerBi}
            asOf={view.asOfDate}
          />
        }
      />

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
        <Workspace>
          {/* ---------------------------------------------------------------- */}
          {/* ROW 1 — the rail                                                  */}
          {/* ---------------------------------------------------------------- */}
          <GridRow>
            <Module
              id="performance"
              title="Result"
              zone="performance"
              visual="kpi-rail"
              note={
                view.conditionFilterApplied
                  ? 'A condition is selected, so units and gross are read from the exported condition split rather than re-filtering a total that carries no split.'
                  : undefined
              }
              meta={view.periodContext.period.label}
            >
              <SalesRail
                metrics={view.performance}
                comparisonLabel={comparisonLabel}
                comparisonUnavailable={view.periodContext.comparisonUnavailable}
              />
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 2 — the three modules the viewport contract is measured on    */}
          {/* ---------------------------------------------------------------- */}
          {/*
            `UX.2B` §49 asks Sales & Gross to show the rail, the primary trend and at least
            one comparison visual inside 1440 × 900. Two comparisons are here rather than
            one, and they are the right two on the merits: the shape of the period, whose
            volume it was, and what it was made of are the three follow-up questions a GSM
            asks in that order. Everything below this row answers a fourth.
          */}
          <GridRow>
            <Module
              id="trend"
              title="How the period accumulated"
              span={6}
              zone="performance"
              visual="trend"
              meta={granularityMeta(view.series.granularity)}
            >
              <SalesTrend series={view.series} comparisonLabel={comparisonLabel} />
            </Module>
            <Module
              id="stores"
              title="Stores"
              span={3}
              zone="performance"
              visual="store-comparison"
            >
              {storeMix === undefined ? null : (
                <StoreContribution
                  mix={storeMix}
                  singleStore={view.scope.stores.length < 2}
                />
              )}
            </Module>
            <Module
              id="mix"
              title="New and used"
              span={3}
              zone="performance"
              visual="condition-split"
            >
              {conditionMix === undefined ? null : <ConditionSplit mix={conditionMix} />}
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 3 — attribution, and the plan                                 */}
          {/* ---------------------------------------------------------------- */}
          {/*
            THE BRIDGE MOVED FROM THE FOOT OF THE PAGE TO THE SECOND SCREEN. It was last
            because it is the most interpretive thing on the surface and a reader who has
            seen units, rate and mix reads it as a summary rather than as a verdict. That
            reasoning was right and is preserved — it is still BELOW all three of those —
            but "below" used to mean 5,900 px down, which is not a position in a reading
            order so much as an omission. `UX.2B` §10 asks for it as a major visual.

            THE PLAN IS STILL NOT A FOURTH BRIDGE EFFECT. The bridge decomposes a
            period-over-period CHANGE into volume, front-rate and back-rate; plan variance
            answers a different question, and adding it as a fourth effect would change what
            the other three mean. It sits beside the bridge, not inside it.
          */}
          <GridRow>
            <Module
              id="bridge"
              title="What the bridge attributes the change to"
              span={7}
              visual="bridge"
              /*
                NO MODULE NOTE, DELIBERATELY. The section below already states, in the block
                under the waterfall, that the decomposition is an attribution under a
                documented arithmetic order and not a cause. A module note repeating it would
                be the same caveat printed twice on one screen — which is not twice as
                honest, and is a third of the prose this pass removed.
              */
            >
              <BridgeSection bridge={view.bridge} />
            </Module>
            <Module
              id="targets"
              title="Plan and pace"
              span={5}
              zone="plan"
              visual="pace"
              note="The projection is selling-day arithmetic, not a forecast. Targets are synthetic operating goals, not benchmarks. A monthly plan is a single-month figure, so it is a reference beside the totals rather than a flat line drawn onto the trend."
            >
              <TargetPaceSection context={view.targets} headingLevel="h4" />
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 4 — the population, what it was made of, what was given away  */}
          {/* ---------------------------------------------------------------- */}
          <GridRow>
            <Module
              id="distribution"
              title="The shape of the deal population"
              span={5}
              visual="distribution"
              note="Deal gross has a long tail, so the mean sits above the typical deal. Median and mean are shown together because either alone invites the wrong conclusion."
              meta={
                <a
                  href={dealsHref}
                  className="inline-flex min-h-6 items-center underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                >
                  Open these deals
                </a>
              }
            >
              <DistributionSection distribution={view.distribution} />
            </Module>
            <Module
              id="contribution"
              title="Gross composition"
              span={4}
              zone="performance"
              visual="gross-composition"
            >
              <GrossComposition
                title="Front and back"
                caption="The finance office's contribution beside the vehicle's, as a share of the governed total."
                segments={[
                  ...(front.kind === 'value'
                    ? [
                        {
                          key: 'front',
                          label: 'Front gross',
                          value: front.value,
                          display: front.display,
                        },
                      ]
                    : []),
                  ...(back.kind === 'value'
                    ? [
                        {
                          key: 'back',
                          label: 'Back gross',
                          value: back.value,
                          display: back.display,
                        },
                      ]
                    : []),
                ]}
                total={total !== undefined && total.kind === 'value' ? total.value : null}
                shareDisclosure="Front and back are published separately and are not ranked against each other. A store can hold total gross steady while front collapses and the finance office compensates, and that is a materially different situation from one where both are stable: which is preferable depends on the store, not on the figure."
                headingLevel={4}
              />
            </Module>
            <Module
              id="discounts"
              title="Discount taken, per unit"
              span={3}
              note="The MSRP discount divides by the units that actually carry an MSRP, which is fewer than the retail count."
            >
              <PerformanceGrid
                metrics={view.discounts}
                comparisonLabel={comparisonLabel}
                columns="single"
              />
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 5 — detail, on demand                                         */}
          {/* ---------------------------------------------------------------- */}
          <GridRow>
            <Module id="detail" title="Detail, on demand" span={12}>
              <ConsoleDisclosure
                id="sale-type"
                summary="Units by sale type"
                note="Unit counts only. The export publishes no per-sale-type gross, and apportioning the retail total across sale types would invent a measure the reporting layer does not own."
              >
                {saleTypeMix === undefined ? null : <SaleTypeDetail mix={saleTypeMix} />}
              </ConsoleDisclosure>

              <Text size="sm" tone="muted">
                Every figure on this page is the sum of finalized transactions. To see the
                transactions themselves, open the{' '}
                <a
                  href={dealsHref}
                  className="inline-flex min-h-6 items-center underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                >
                  Deal Explorer
                </a>
                , which carries this period and store selection.
              </Text>
            </Module>
          </GridRow>
        </Workspace>
      )}
    </Canvas>
  )
}

/* -------------------------------------------------------------------------- */
/* Page helpers                                                                */
/* -------------------------------------------------------------------------- */

/** One mix breakdown by its view-model identifier, never by array position. */
function mixById(mixes: readonly MixBreakdown[], id: string): MixBreakdown | undefined {
  return mixes.find((mix) => mix.id === id)
}

/** The trend's own granularity, in the module's meta slot rather than in a lede. */
function granularityMeta(granularity: string): string {
  if (granularity === 'daily') return 'One column per sale date'
  if (granularity === 'weekly') return 'One column per ISO week'
  return 'One column per calendar month'
}

/**
 * A body of detail, collapsed but not removed.
 *
 * `<details>` keeps its contents in the document, in the accessibility tree's reading order,
 * in a browser text search and with scripting off — the same technique every chart on this
 * page uses for its data table. The `id` stays on the element because it was a region anchor.
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
          <p className="max-w-prose text-xs leading-normal text-ink-faint">{note}</p>
        )}
        {children}
      </div>
    </details>
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
