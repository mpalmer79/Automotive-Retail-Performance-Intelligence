import type { Metadata } from 'next'

import { Canvas } from '@/components/shell/field'
import { DealIndex, DealPagination } from '@/components/dashboard/deal-index'
import { DealSummaryStrip } from '@/components/dashboard/deal-summary'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import {
  FilterNotice,
  PeriodNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { GridRow, Module, Workspace } from '@/components/dashboard/workspace-grid'
import { Text } from '@/components/ui/typography'
import {
  calendarMonths,
  dashboardConditionGroups,
  dashboardLeadSources,
  dashboardManifest,
  dashboardStores,
} from '@/lib/dashboard/data'
import { buildDeals, parseListState } from '@/lib/dashboard/deals'
import {
  activeFilterChips,
  DEAL_EXPLORER_SUPPORT,
  parseFilters,
  serializeFilters,
  type QueryInput,
} from '@/lib/dashboard/filters'
import { formatIsoMonth } from '@/lib/dashboard/format'
import { filtersForRoute, operatingHref } from '@/lib/dashboard/navigation'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardDeals')

const ROUTE = ROUTES.dashboardDeals.href

/**
 * The Deal Explorer — every finalized transaction behind the aggregates.
 *
 * WHAT `UX.2B` CHANGED HERE, AND WHAT IT DELIBERATELY DID NOT
 * ----------------------------------------------------------
 * This route was already the closest of the five to what `UX.2B` asks for: a control band, a
 * table, and 128 words of visible prose. `UX.2B` §48 says outright not to enforce a prose
 * reduction on a route that is primarily a data grid, and §13 says not to replace exact
 * transaction inspection with charts. Neither was done. There is no chart on this page and
 * there was never going to be one.
 *
 * What was missing is what §15 names: the filtered population's size was a chip in the page
 * header and what it was WORTH was not stated at all, so a reader who narrowed to one store
 * and one month met twenty-five rows out of six hundred with no way to tell whether the filter
 * was the one they meant. The summary strip states it, above the table, from sums over the
 * same rows the table pages through.
 *
 * The rest is layout: the section band becomes two modules of the console's workspace grid,
 * and the table's three attribution columns move into a disclosure so the ten money-and-
 * identity columns a desk reviews are what a reader meets first.
 *
 * A MANAGEMENT DEAL LOG, NOT A CRM
 * --------------------------------
 * The columns are the ones a desk reviews: what sold, for how much, what it made,
 * how long it sat, where the lead came from and who worked it. There is no customer,
 * no contact detail, no note field and no free text of any kind — none of it is
 * exported, and none of it exists in the public lane to expose.
 *
 * THE WHOLE POPULATION STAYS ON THE SERVER
 * ----------------------------------------
 * Filtering, searching, sorting and paging all happen in the server component, over
 * the partitions the store and period selection covers. One page of rows reaches the
 * browser as HTML. There is no client-side dataset and nothing fetches more.
 *
 * EVERY CONTROL IS A LINK OR A FORM
 * ---------------------------------
 * Sorting is anchors, paging is anchors, searching is a GET form. The page works
 * with JavaScript disabled, every state is a shareable URL, and browser history is
 * the undo stack.
 */
export default async function DealExplorerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = (await searchParams) as QueryInput
  const parsed = parseFilters(query, {
    knownStores: dashboardStores.map((store) => store.id),
    knownSources: dashboardLeadSources.map((source) => source.code),
  })
  const list = parseListState(query as Record<string, string | string[] | undefined>)
  const view = buildDeals(parsed.filters, list.state)

  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)
  const failedReconciliation = reconciliationFailed(dashboardManifest)
  const chips = activeFilterChips(parsed.filters, DEAL_EXPLORER_SUPPORT)
  /*
   * THE QUERY THIS ROUTE CARRIES THROUGH ITS OWN NAVIGATION.
   *
   * Reduced to what the Deal Explorer declares it can act on BEFORE it is serialized.
   * `UX.2D` §11-§12: the sort headers, the pager, the search form's hidden fields and
   * the "clear search" link all ride on this string, and on `main` it was the whole
   * filter context — so `/dashboard/deals?period=2025-11&compare=prior-year` reproduced
   * `compare=prior-year` in every one of them, on a route that declares `compare`
   * not-applicable and shows no comparison anywhere.
   */
  const filterQuery = serializeFilters(filtersForRoute(parsed.filters, ROUTE))
  /*
   * The drill-through BACK to the aggregate (`UX.2B` §47). `operatingHref` reduces the
   * filter state to what Sales & Gross can act on, so the search term and the sale-type
   * scope — which that route publishes no gross for — are not appended to a destination
   * that would ignore them.
   */
  const salesGrossHref = operatingHref(ROUTES.dashboardSalesGross.href, parsed.filters)

  return (
    <Canvas>
      {/* ------------------------------------------------------------------ */}
      {/* Context, search and filters                                         */}
      {/* ------------------------------------------------------------------ */}
      <OperatingPageHeader
        title="Deal Explorer"
        context={operatingContext([
          `${String(view.totalCount)} deals`,
          view.scopeLabel,
          view.periodContext.period.label,
        ])}
        methodology={
          <ExportProvenance
            exportState={exportState}
            powerBi={powerBi}
            asOf={view.asOfDate}
          />
        }
        chips={chips}
        filterState={parsed.filters}
        route={ROUTE}
        notices={
          <div className="flex flex-col gap-4 empty:hidden">
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={failedReconciliation} />
            <FilterNotice resets={parsed.reset} resetHref={ROUTE} />
            <PeriodNotice notices={view.periodContext.notices} />
          </div>
        }
        filters={
          <div className="flex flex-col gap-4">
            {list.reset.length > 0 ? (
              <div
                role="status"
                className="rounded-lg border border-line bg-surface-sunken/60 p-4"
              >
                <Text size="sm" tone="secondary">
                  {list.reset
                    .map(
                      (entry) =>
                        `The ${entry.key} value "${entry.value}" was not usable and was reset. ${entry.reason}`
                    )
                    .join(' ')}
                </Text>
              </div>
            ) : null}

            {view.pageClamped ? (
              <div
                role="status"
                className="rounded-lg border border-line bg-surface-sunken/60 p-4"
              >
                <Text size="sm" tone="secondary">
                  {`That page is past the end of this result set, so the last page is shown instead. There ${view.pageCount === 1 ? 'is 1 page' : `are ${String(view.pageCount)} pages`} of results.`}
                </Text>
              </div>
            ) : null}

            {/* Search. A native GET form: it needs no JavaScript, its result is a
                URL, and its state survives a reload and a share. */}
            <form method="get" action={ROUTE} className="flex flex-wrap items-end gap-3">
              {/* The global filters ride along as hidden fields, so searching does
                  not silently discard the period or store the reader chose. */}
              {hiddenFilterFields(filterQuery)}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label
                  htmlFor="deal-search"
                  className="text-xs font-medium text-ink-muted"
                >
                  Search deals
                </label>
                <input
                  id="deal-search"
                  name="q"
                  type="search"
                  defaultValue={view.state.query}
                  placeholder="Deal id, unit id, make or model"
                  className="min-h-touch rounded-md border border-line-subtle bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
              </div>
              <button
                type="submit"
                className="inline-flex min-h-touch items-center rounded-md border border-line-subtle px-4 text-sm font-medium text-ink transition-colors duration-(--arpi-motion-fast) hover:border-accent hover:text-accent"
              >
                Search
              </button>
              {view.state.query === '' ? null : (
                <a
                  href={filterQuery === '' ? ROUTE : `${ROUTE}?${filterQuery}`}
                  className="inline-flex min-h-touch items-center text-sm text-ink-muted underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                >
                  Clear search
                </a>
              )}
            </form>

            <FilterBar
              action={ROUTE}
              support={DEAL_EXPLORER_SUPPORT}
              filters={parsed.filters}
              periodOptions={periodOptions()}
              stores={storeOptions()}
              conditions={conditionOptions()}
              leadSources={leadSourceOptions()}
              conditionHint="Selects deals by the vehicle's condition."
              leadSourceHint="Selects deals with a linked lead from that source. Walk-in deals are excluded when a source is chosen."
            />
          </div>
        }
      />

      <Workspace>
        {/* ---------------------------------------------------------------- */}
        {/* ROW 1 — what the filter actually selected                         */}
        {/* ---------------------------------------------------------------- */}
        <GridRow>
          <Module
            id="population"
            title="This filter selects"
            note="Deals counts every matched transaction; the money figures are over the retail rows only, because a wholesale disposal belongs in the table below and not in a retail gross total. A deal that closed at a front-end loss is counted rather than suppressed."
            zone="performance"
            meta={view.periodContext.period.label}
          >
            <DealSummaryStrip
              view={view}
              dealsLabel={
                view.state.query === ''
                  ? 'Matching the current filters'
                  : `Matching the current filters and the search "${view.state.query}"`
              }
            />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 2 — the transactions                                          */}
        {/* ---------------------------------------------------------------- */}
        <GridRow>
          <Module
            id="deals"
            title="The transactions behind the aggregate"
            note="A wholesale disposal or dealer trade is shown and labelled as not retail: it is a real transaction, and judging it by retail measures would be the error, not showing it."
            meta={
              <a
                href={salesGrossHref}
                className="inline-flex min-h-6 items-center underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
              >
                Sales &amp; Gross for this scope
              </a>
            }
          >
            <div className="flex flex-col gap-4">
              <DealIndex
                route={ROUTE}
                filterQuery={filterQuery}
                state={view.state}
                rows={view.rows}
              />

              <DealPagination
                route={ROUTE}
                filterQuery={filterQuery}
                state={view.state}
                pageCount={view.pageCount}
                totalCount={view.totalCount}
                firstRowNumber={view.firstRowNumber}
                lastRowNumber={view.lastRowNumber}
              />

              <Text size="xs" tone="faint">
                Each deal id opens its Deal Jacket: the transaction explained to the cent,
                with the cost components behind its front gross, its trade context, staff
                attribution, lead timeline, integrity checks and lineage.
              </Text>
            </div>
          </Module>
        </GridRow>
      </Workspace>
    </Canvas>
  )
}

/**
 * The active global filters as hidden inputs, so the search form preserves them.
 *
 * Rebuilt from the serialized query rather than from the filter object, so this can
 * never disagree with what the canonical serializer produces.
 */
function hiddenFilterFields(filterQuery: string) {
  if (filterQuery === '') return null
  const pairs = filterQuery.split('&').map((part) => part.split('='))
  return (
    <>
      {pairs.map(([key, value], index) => (
        <input
          key={`${key ?? ''}-${String(index)}`}
          type="hidden"
          name={decodeURIComponent(key ?? '')}
          value={decodeURIComponent(value ?? '')}
        />
      ))}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Filter options                                                              */
/* -------------------------------------------------------------------------- */

function periodOptions(): readonly FilterOption[] {
  return calendarMonths.map((month) => ({ value: month, label: formatIsoMonth(month) }))
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
