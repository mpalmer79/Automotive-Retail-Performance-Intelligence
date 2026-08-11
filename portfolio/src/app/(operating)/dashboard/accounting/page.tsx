import type { Metadata } from 'next'

import {
  BalanceComparison,
  ComparisonStates,
  ExceptionRegister,
  PeriodOwnership,
  PositionRail,
  PositionTable,
} from '@/components/dashboard/accounting-workspace'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import { GridRow, Module, Workspace } from '@/components/dashboard/workspace-grid'
import {
  ActiveFilterChips,
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import {
  FilterNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { Canvas } from '@/components/shell/field'
import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import {
  accountingExceptionRows,
  glReconciliationRows,
} from '@/lib/dashboard/accounting-data'
import {
  CONTROLLED_SCENARIO_NOTE,
  comparisonDates,
  exceptionDrillThrough,
  resolveComparisonDate,
  selectComparisons,
  selectExceptions,
  summarize,
  toComparisonRows,
  toExceptionRows,
  varianceDirection,
} from '@/lib/dashboard/accounting'
import { dashboardManifest, dashboardStores } from '@/lib/dashboard/data'
import {
  ACCOUNTING_SUPPORT,
  activeFilterChips,
  parseFilters,
  type QueryInput,
} from '@/lib/dashboard/filters'
import { formatIsoDate } from '@/lib/dashboard/format'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardAccounting')

const ROUTE = ROUTES.dashboardAccounting.href

/**
 * Accounting integrity — the controller's surface.
 *
 * WHAT THIS PAGE IS, AND WHAT IT REFUSES TO BE
 * --------------------------------------------
 * It is an INVENTORY CONTROL RECONCILIATION. It answers whether the inventory subledger
 * agrees with what the selected synthetic GL control accounts say, and where it does not.
 *
 * It is NOT a general ledger, and the absence is structural rather than stylistic: no
 * journal entry, journal line, debit/credit pair, posting batch, trial balance, period close
 * or financial statement exists anywhere in the export, so there is nothing here for such a
 * section to read. The page shows exact numbers in tables rather than gauges or scores,
 * because a reconciliation table is the artefact a controller actually checks and a "books
 * health" dial would be a decoration standing in front of the only thing worth reading.
 *
 * THE FOUR THINGS THE COPY ON THIS PAGE HAS TO GET RIGHT
 * ------------------------------------------------------
 * 1. The variance is SIGNED, and the direction is stated in words next to it rather than
 *    left to a minus glyph or a colour.
 * 2. A missing side is MISSING. It renders as "No GL balance" or "No subledger balance",
 *    never as $0.00, and it is excluded from the totals rather than counted as agreement.
 * 3. The balances are positions at ONE date. The page states which date it resolved and
 *    never sums or averages across dates.
 * 4. A variance is something to investigate, not proof of an error — and in this dataset
 *    some of them are planted on purpose. Both facts are on the page, not in a footnote.
 *
 * WHAT THIS ROUTE WAS, MEASURED, AND WHAT IT IS NOW
 * ------------------------------------------------
 * `docs/reviews/UX-2C-BASELINE.md` measured it on the merge of `UX.2B.1`: **zero framed
 * figures at any viewport**, down a 3,290 px document of four regions. The three figures a
 * controller opens the page for arrived FOURTH, after a subtitle, a filter bar, a disclosure,
 * an eyebrow, an `h2` and a lede — and arrived as four equal cells in which the signed variance
 * was a peer of "positions not comparable".
 *
 * `UX.2C` rebuilds it as the twelve-column module grid: the three balances lead, at three times
 * the weight of the four figures that qualify them; the comparison itself is two bars on one
 * shared scale with the difference marked on the same axis; and the four governed comparison
 * states are a drawn population rather than a count and a sentence. The `Period ownership`
 * region — 130 of the route's 422 words, at the foot of the page — is a table behind a
 * disclosure, which is where `UX.2C` §46 puts detail a reader needs exactly once.
 *
 * THE NOT-A-GENERAL-LEDGER LIMITATION STAYS VISIBLE (`UX.2C` §32). It is the route's subtitle,
 * where it cannot scroll away. What went behind the disclosure is the FULL explanation — the
 * two-sides-from-one-model statement, the invented chart of accounts, the planted scenarios —
 * and no P&L, EBITDA, department statement, cash flow, journal entry, trial balance, contract
 * in transit, receivable or floorplan interest arrived to replace it, because none of it exists
 * in the export.
 *
 * THE FIRST-VIEWPORT CONTRACT (`UX.2C` §5 and §52). At 1440 x 900: the control band, the
 * seven-figure position rail whole, and both geometry modules — the balance comparison and the
 * state population. Each carries `data-visual-region`, so the contract is measured, not
 * asserted.
 */
export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = (await searchParams) as QueryInput
  const parsed = parseFilters(query, {
    knownStores: dashboardStores.map((store) => store.id),
  })

  const comparisons = toComparisonRows(glReconciliationRows())
  const dates = comparisonDates(comparisons)
  const comparisonDate = resolveComparisonDate(comparisons, parsed.filters)
  const selected = selectComparisons(comparisons, comparisonDate, parsed.filters)
  const summary = summarize(selected, comparisonDate)
  const exceptions = selectExceptions(
    toExceptionRows(accountingExceptionRows()),
    parsed.filters
  )

  /*
   * The physical count standing behind the schedule at this date.
   *
   * A SELECTION, NOT A MEASURE. `stock_unit_count` is an exported column and a unit belongs to
   * exactly one control account, so summing it across the positions at ONE date is addition of
   * a partition rather than a new statistic — and it is never summed across dates, for the same
   * reason the balances are not. A position that does not publish one contributes nothing, and
   * where no position publishes one the rail says "Not published" rather than zero.
   */
  const unitRows = selected.filter((row) => row.stockUnitCount !== null)
  const stockUnits =
    unitRows.length === 0
      ? null
      : unitRows.reduce((total, row) => total + (row.stockUnitCount ?? 0), 0)

  const chips = activeFilterChips(parsed.filters, ACCOUNTING_SUPPORT)
  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)
  const failedReconciliation = reconciliationFailed(dashboardManifest)

  // The period options are the comparison dates the reconciliation actually carries, not
  // the whole calendar: a month with no comparison is not a month this page may offer and
  // then render empty.
  const storeOptions: readonly FilterOption[] = dashboardStores.map((store) => ({
    value: store.id,
    label: store.shortName,
  }))
  const periodOptions: readonly FilterOption[] = dates.map((date) => ({
    value: date.slice(0, 7),
    label: formatIsoDate(date),
  }))

  return (
    <Canvas>
      <OperatingPageHeader
        title="Accounting"
        context={operatingContext([
          parsed.filters.store.length === 0
            ? 'All three stores'
            : parsed.filters.store.join(', '),
          comparisonDate === null
            ? 'No comparison date in this period'
            : `Position at ${formatIsoDate(comparisonDate)}`,
        ])}
        subtitle="Inventory control reconciliation. Not a general ledger."
        methodology={
          <ExportProvenance
            exportState={exportState}
            powerBi={powerBi}
            {...(comparisonDate === null ? {} : { asOf: comparisonDate })}
          />
        }
      >
        <div className="flex flex-col gap-4">
          <StaleBanner stale={exportState.stale} />
          <ReconciliationBanner failed={failedReconciliation} />
          <FilterNotice resets={parsed.reset} resetHref={ROUTE} />

          <ActiveFilterChips chips={chips} />

          <FilterBar
            action={ROUTE}
            filters={parsed.filters}
            periodOptions={periodOptions}
            stores={storeOptions}
            conditions={[]}
            leadSources={[]}
            conditionHint="Not applied here. A control balance is a store-and-account position; vehicle condition decides which control account a unit belongs to, and that grouping is already the account."
            leadSourceHint="Not applied here. The accounting datasets carry no lead-source attribute."
          />

          <Disclosure label="What this page reconciles, and what it does not">
            <div className="flex flex-col gap-3">
              <Text size="sm">
                Both sides of this comparison are generated from one governed synthetic
                model. It is not agreement between two independent systems, and no figure
                here is an audit, a certification or an external validation.
              </Text>
              <Text size="sm">{CONTROLLED_SCENARIO_NOTE}</Text>
              <Text size="sm">
                The balances are positions at a date. They add across stores and control
                accounts on the comparison date shown and never across dates: a period
                selects the last comparison date inside it rather than a sum of them.
              </Text>
              <Text size="sm">
                Every control account is invented. No real dealer group&rsquo;s chart of
                accounts was consulted, and the catalogue is three selected inventory
                control accounts rather than a chart of accounts.
              </Text>
            </div>
          </Disclosure>
        </div>
      </OperatingPageHeader>

      <Workspace>
        {/* ---------------------------------------------------------------- */}
        {/* ROW 1 — the position                                              */}
        {/* ---------------------------------------------------------------- */}
        <GridRow>
          <Module
            id="summary"
            title="The position"
            visual="position-rail"
            meta={
              comparisonDate === null
                ? 'No comparison date in this period'
                : formatIsoDate(comparisonDate)
            }
          >
            <PositionRail
              summary={summary}
              exceptionCount={exceptions.length}
              stockUnits={stockUnits}
            />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 2 — the comparison, and the population of states it came from */}
        {/* ---------------------------------------------------------------- */}
        {/*
          THE TWO BELONG SIDE BY SIDE. The balance comparison answers "by how much"; the state
          population answers "over what". A reader who saw only the first would not know that
          two of the positions have no variance at all because a side is absent, and a reader
          who saw only the second would not know the size of the difference among the ones
          that do. Neither figure is complete without the other in view.
        */}
        <GridRow align="start">
          <Module
            id="positions"
            title="Schedule against control"
            span={7}
            visual="balance-comparison"
          >
            <BalanceComparison
              summary={summary}
              directionText={varianceDirection(summary.signedVariance)}
            />
          </Module>
          <Module
            id="states"
            title="Comparison states"
            span={5}
            visual="comparison-states"
          >
            <ComparisonStates summary={summary} rows={selected} />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 3 — the detail a controller actually ticks off                */}
        {/* ---------------------------------------------------------------- */}
        <GridRow>
          <Module
            id="detail"
            title="Each control account, by store"
            span={12}
            meta={`${String(summary.totalPositions)} position${summary.totalPositions === 1 ? '' : 's'}`}
            note="A missing side is shown as missing, never as $0.00, and is excluded from both totals."
          >
            <PositionTable rows={selected} comparisonDate={comparisonDate} />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 4 — exceptions, and the date bases                            */}
        {/* ---------------------------------------------------------------- */}
        <GridRow align="start">
          <Module
            id="exceptions"
            title="Accounting exceptions"
            span={8}
            meta={`${String(exceptions.length)} in scope`}
            note="Each on its own exception date. Not one kind of finding, and deliberately not totalled together."
          >
            <ExceptionRegister
              entries={exceptions.map((row) => ({
                exceptionId: row.exceptionId,
                exceptionCode: row.exceptionCode,
                dealershipId: row.dealershipId,
                exceptionDate: row.exceptionDate,
                exceptionAmount: row.exceptionAmount,
                exceptionDetail: row.exceptionDetail,
                href: exceptionDrillThrough(row),
              }))}
              scenarioNote={CONTROLLED_SCENARIO_NOTE}
            />
          </Module>
          <Module id="timing" title="Period ownership" span={4}>
            <PeriodOwnership />
          </Module>
        </GridRow>
      </Workspace>
    </Canvas>
  )
}
