import type { Metadata } from 'next'

import { Canvas } from '@/components/shell/field'
import { GridRow, Module, Workspace } from '@/components/dashboard/exec-grid'
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
  ConditionSplit,
  ContributionSection,
  DiscountSection,
  DistributionSection,
  SaleTypeMix,
  SalesKpiRail,
  StoreContribution,
  TrendSection,
} from '@/components/dashboard/sales-gross-sections'
import { TargetPaceSection } from '@/components/dashboard/target-context'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  ActiveFilterChips,
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
import { buildSalesGross, type SalesGrossView } from '@/lib/dashboard/sales-gross'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardSalesGross')

const ROUTE = ROUTES.dashboardSalesGross.href

/**
 * Sales and gross — the general sales manager's workspace.
 *
 * A WORKSPACE, NOT A DIAGNOSTIC ESSAY
 * -----------------------------------
 * `UX.1` left this route as eight full-width bands, each opening with an eyebrow, an `h2`
 * and a two-to-four-line lede, stacked down a 7,228 px document. Measured on the merge of
 * `UX.2A`, at 1440 × 900: the first framed visualization began 2,752 px down — three
 * screens — and the first viewport contained a control band, a notice stack, a filter form
 * and the top edge of nine identical metric tiles, nine of which carried their own
 * `How is this calculated?` disclosure. Every figure was present and a manager had to
 * scroll past three screens of prose to meet a single shape.
 *
 * `UX.2B` rebuilds it on the twelve-column module grid `UX.2A` established. The eight
 * region headings are gone, because a module's own title says what it holds, and
 * `Performance` above a rail of governed figures was the page talking to itself.
 *
 * THE QUESTIONS, IN THE ORDER A GSM ASKS THEM
 * -------------------------------------------
 * How many units, how much gross, what is GPRU — the rail. What changed — the trend and,
 * decisively, the bridge. Was it front or back — the composition. New or used — the
 * condition split. Which store — the contribution bars. What does the deal population look
 * like — the two distributions. Seven questions, seven modules, and the first four are on
 * one screen.
 *
 * THE BRIDGE IS THE PAGE'S LARGEST VISUAL AND ITS ARITHMETIC IS UNTOUCHED
 * ----------------------------------------------------------------------
 * `UX.2B` §3 requires the bridge's authority to be preserved exactly, and it is:
 * `vw_gross_change_bridge` owns the decomposition, `buildBridge` reads the exported
 * numerators and verifies the identity, and this route renders what that returns. What
 * changed is that it is now eight columns wide, one row below the rail and the trend, rather
 * than the last band of a nine-screen document. Signed steps take the semantic pair, the two anchors take the neutral
 * reference fill because a level is not a direction, and every exact amount is still
 * printed beside its label.
 *
 * WHAT DID NOT CHANGE. No KPI definition, no numerator, no denominator, no date basis, no
 * rate re-aggregation rule, no bridge arithmetic and no export. Every figure comes from the
 * same governed selector through `buildSalesGross()`, evaluated on the server. The one
 * addition to the view model is a selection: the per-deal discount from original asking,
 * counted into bands and RECONCILED against the governed period total it must sum to.
 *
 * A SERVER COMPONENT. One client island, the filter bar, receives option lists and no data.
 * The trend's metric switch is a radio group and CSS: it ships no JavaScript, it works with
 * scripting off, and it cannot recalculate anything because there is no code in it. With
 * scripting disabled every figure, every table and every chart's data alternative is still
 * in the document.
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

  const conditionMix = mixById(view, 'condition')
  const storeMix = mixById(view, 'store')
  const saleTypeMix = mixById(view, 'sale-type')
  const totals = figuresById(view, ['retail-units', 'total-gross'])

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
            <ActiveFilterChips chips={view.chips} />
          </div>
        }
        filters={
          <FilterBar
            action={ROUTE}
            filters={parsed.filters}
            periodOptions={periodOptions()}
            stores={storeOptions()}
            conditions={conditionOptions()}
            leadSources={leadSourceOptions()}
            leadSourceHint="Not applied here. Deal-level attribution is in the Deal Explorer."
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
          {/*
            The condition note is the one sentence a reader would misread the rail without,
            and only when a condition filter is in force: under `condition=New` the units
            and gross figures are read from a DIFFERENT governed column rather than from a
            re-filtered total, and a reader who assumes the latter will not understand why
            the sale-type counts below did not move with them.
          */}
          <GridRow>
            <Module
              id="performance"
              title="Result"
              zone="performance"
              visual="kpi-rail"
              meta={view.periodContext.period.label}
              {...(view.conditionFilterApplied
                ? {
                    note: 'Units and gross are read from the exported condition split, so the selected condition changes which governed column is summed rather than re-filtering a total that carries no split.',
                  }
                : {})}
            >
              <SalesKpiRail
                metrics={view.performance}
                comparisonLabel={comparisonLabel}
              />
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 2 — shape, mix, whose                                         */}
          {/* ---------------------------------------------------------------- */}
          {/*
            THE FIRST-VIEWPORT CONTRACT IS MET HERE. Three modules of data-driven geometry
            sit beside each other under the rail: the shape of the period, what the volume
            was made of, and which store it came from. They are also the right three on the
            merits — they are the three follow-up questions a general manager asks after
            reading the rail, and none of them needs the reader to have scrolled.
          */}
          <GridRow>
            <Module
              id="trend"
              title="How the period accumulated"
              span={6}
              zone="performance"
              visual="trend"
              meta="Columns, not a line"
            >
              <TrendSection series={view.series} comparisonLabel={comparisonLabel} />
            </Module>
            <Module
              id="mix"
              title="New and used"
              span={3}
              zone="performance"
              visual="condition"
            >
              {conditionMix === null ? null : (
                <ConditionSplit
                  mix={conditionMix}
                  totalUnits={totals['retail-units'] ?? { kind: 'no-rows' }}
                  totalGross={totals['total-gross'] ?? { kind: 'no-rows' }}
                />
              )}
            </Module>
            <Module
              id="stores"
              title="Stores"
              span={3}
              zone="performance"
              visual="store-contribution"
            >
              {storeMix === null ? null : <StoreContribution mix={storeMix} />}
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 3 — the bridge, as the page's major visual, and what it splits */}
          {/* ---------------------------------------------------------------- */}
          {/*
            EIGHT COLUMNS, AND IT USED TO BE THE LAST BAND ON THE DOCUMENT.

            `UX.1` put the bridge last on the grounds that it is the most interpretive thing
            on the page and a reader who has already seen units, rate and mix reads it as a
            summary rather than as a verdict. That reasoning is sound and it survives: the
            rail, the trend, the mix and the store contribution are all ABOVE this row, so a
            reader still meets the bridge having already met the figures it decomposes. What
            has changed is that they meet it at all — at 7,228 px the previous document put
            it below six screens of scrolling, which is not "last", it is "unread".
          */}
          <GridRow align="start">
            <Module
              id="bridge"
              title="What the decomposition attributes the change to"
              span={8}
              zone="performance"
              visual="bridge"
            >
              <BridgeSection bridge={view.bridge} />
            </Module>
            <Module
              id="contribution"
              title="Gross composition"
              span={4}
              zone="performance"
              visual="composition"
            >
              <ContributionSection
                front={view.contribution.front}
                back={view.contribution.back}
                frontShare={view.contribution.frontShare}
                backShare={view.contribution.backShare}
                total={totals['total-gross'] ?? { kind: 'no-rows' }}
              />
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 4 — the plan, and the two distributions                       */}
          {/* ---------------------------------------------------------------- */}
          <GridRow align="start">
            <Module
              id="targets"
              title="Plan and pace"
              span={4}
              zone="plan"
              visual="pace"
              note="The projection is selling-day arithmetic, not a forecast. Targets are synthetic operating goals, not benchmarks."
            >
              <TargetPaceSection context={view.targets} headingLevel="h4" />
            </Module>
            <Module
              id="distribution"
              title="Deal gross, distributed"
              span={3}
              zone="performance"
              visual="deal-gross"
            >
              <DistributionSection distribution={view.distribution} />
            </Module>
            <Module
              id="discounts"
              title="What was given away"
              span={5}
              zone="performance"
              visual="discount"
            >
              <DiscountSection
                distribution={view.discountDistribution}
                metrics={view.discounts}
                comparisonLabel={comparisonLabel}
              />
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 5 — sale type, and the way out                                */}
          {/* ---------------------------------------------------------------- */}
          <GridRow align="start">
            <Module id="sale-type" title="By sale type" span={5}>
              {saleTypeMix === null ? null : <SaleTypeMix mix={saleTypeMix} />}
            </Module>
            <Module id="next" title="The transactions themselves" span={7}>
              <Text size="sm" tone="muted">
                Every figure on this page is the sum of finalized transactions. To see the
                transactions, open the{' '}
                <a
                  href={ROUTES.dashboardDeals.href}
                  className="inline-flex min-h-6 items-center underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                >
                  Deal Explorer
                </a>
                , which carries the same period and store selection.
              </Text>
            </Module>
          </GridRow>
        </Workspace>
      )}
    </Canvas>
  )
}

/* -------------------------------------------------------------------------- */
/* View-model lookups                                                          */
/* -------------------------------------------------------------------------- */
// The modules need three of the mixes and two of the nine figures by name. Looked up
// rather than positioned, so reordering the view model cannot silently hand a module the
// wrong measure.

function mixById(view: SalesGrossView, id: string) {
  return view.mixes.find((mix) => mix.id === id) ?? null
}

function figuresById(view: SalesGrossView, ids: readonly string[]) {
  const found: Record<string, SalesGrossView['performance'][number]['figure']['current']> =
    {}
  for (const id of ids) {
    const metric = view.performance.find((entry) => entry.id === id)
    if (metric !== undefined) found[id] = metric.figure.current
  }
  return found
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
