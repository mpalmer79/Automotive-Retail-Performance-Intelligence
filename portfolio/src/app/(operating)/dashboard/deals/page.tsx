import type { Metadata } from 'next'

import { Canvas } from '@/components/shell/field'
import { DealIndex, DealPagination } from '@/components/dashboard/deal-index'
import { GridRow, Module, Workspace } from '@/components/dashboard/exec-grid'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  ActiveFilterChips,
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import {
  FilterNotice,
  PeriodNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
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
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardDeals')

const ROUTE = ROUTES.dashboardDeals.href

/**
 * The Deal Explorer — a transaction investigation workspace.
 *
 * A MANAGEMENT DEAL LOG, NOT A CRM
 * --------------------------------
 * The columns are the ones a desk reviews: what sold, for how much, what it made, how long
 * it sat, where the lead came from and who worked it. There is no customer, no contact
 * detail, no note field and no free text of any kind — none of it is exported, and none of
 * it exists in the public lane to expose.
 *
 * WHAT `UX.2B` CHANGED, AND WHAT IT DELIBERATELY DID NOT
 * ------------------------------------------------------
 * §11 says not to force a prose reduction on a route that is already efficient, and this
 * one was: measured on the merge of `UX.2A`, 128 words of visible prose against 616 on the
 * Deal Jacket and 891 on Sales & Gross. It was the leanest surface in the console and the
 * work here was never going to be deletion.
 *
 * What was wrong was DENSITY AND HIERARCHY. Fourteen columns at 1440 px compressed until
 * the four money columns a desk actually scans carried the same visual weight as a
 * salesperson code; the header scrolled away after twenty rows, leaving unlabelled numbers;
 * the result count sat at the FOOT of the table, below the twenty-five rows it described;
 * and the two GET forms — search and filters — were stacked as separate blocks with their
 * own vertical rhythm.
 *
 * So: ten columns by default and four more under `?detail=1`; a sticky header; the count
 * above the rows as well as below them; and one control band. No visualization was added,
 * because a chart over the page of twenty-five rows a reader is currently looking at would
 * describe the page rather than the population, and a chart over the whole population is
 * what `/dashboard/sales-gross` is.
 *
 * THE WHOLE POPULATION STAYS ON THE SERVER
 * ----------------------------------------
 * Filtering, searching, sorting and paging all happen in the server component, over the
 * partitions the store and period selection covers. One page of rows reaches the browser as
 * HTML. There is no client-side dataset and nothing fetches more.
 *
 * EVERY CONTROL IS A LINK OR A FORM. Sorting is anchors, paging is anchors, detail mode is
 * an anchor, searching is a GET form. The page works with JavaScript disabled, every state
 * is a shareable URL, and browser history is the undo stack.
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
  const params = query as Record<string, string | string[] | undefined>
  const list = parseListState(params)
  const view = buildDeals(parsed.filters, list.state)

  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)
  const failedReconciliation = reconciliationFailed(dashboardManifest)
  const chips = activeFilterChips(parsed.filters, DEAL_EXPLORER_SUPPORT)
  const filterQuery = serializeFilters(parsed.filters)

  /*
   * DETAIL MODE IS A PRESENTATION PARAMETER AND IS DELIBERATELY NOT PART OF THE FILTER
   * GRAMMAR. `INFORMATION_ARCHITECTURE.md` §6 defines thirteen console-wide parameters and
   * every one of them changes WHICH ROWS a figure is computed from. This changes which
   * COLUMNS are rendered of the rows already selected, it means nothing on any other route,
   * and a fourteenth grammar parameter that survived a navigation to `/dashboard/inventory`
   * would be a display preference wearing a filter's clothes. It is read from the raw record
   * here, exactly as `q`, `sort` and `page` already are.
   */
  const detail = firstValue(params.detail) === '1'
  /* Everything a sort, page or search link must preserve, as one string. */
  const linkContext = [filterQuery, detail ? 'detail=1' : '']
    .filter((part) => part !== '')
    .join('&')
  const withoutDetail = filterQuery === '' ? ROUTE : `${ROUTE}?${filterQuery}`
  const withDetail = `${ROUTE}?${[filterQuery, 'detail=1'].filter((part) => part !== '').join('&')}`

  const countLine =
    view.totalCount === 0
      ? 'No finalized transaction matches this combination.'
      : `${String(view.totalCount)} deal${view.totalCount === 1 ? '' : 's'} match. Showing ${String(view.firstRowNumber)} to ${String(view.lastRowNumber)}.`

  return (
    <Canvas>
      <OperatingPageHeader
        title="Deal Explorer"
        context={operatingContext([
          `${String(view.totalCount)} deals`,
          view.scopeLabel,
          view.periodContext.period.label,
        ])}
        notices={
          <div className="flex flex-col gap-4 empty:hidden">
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={failedReconciliation} />
            <FilterNotice resets={parsed.reset} resetHref={ROUTE} />
            <PeriodNotice notices={view.periodContext.notices} />

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

            <ActiveFilterChips chips={chips} />
          </div>
        }
        filters={
          <div className="flex flex-col gap-3">
            <FilterBar
              action={ROUTE}
              filters={parsed.filters}
              periodOptions={periodOptions()}
              stores={storeOptions()}
              conditions={conditionOptions()}
              leadSources={leadSourceOptions()}
              conditionHint="Selects deals by the vehicle's condition."
              leadSourceHint="Selects deals with a linked lead from that source. Walk-in deals are excluded when a source is chosen."
            />

            {/* Search. A native GET form: it needs no JavaScript, its result is a URL,
                and its state survives a reload and a share. */}
            <form method="get" action={ROUTE} className="flex flex-wrap items-end gap-3">
              {/* The global filters and the detail mode ride along as hidden fields, so
                  searching does not silently discard the period, the store or the columns
                  the reader chose. */}
              {hiddenFields(linkContext)}
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
                  href={detail ? withDetail : withoutDetail}
                  className="inline-flex min-h-touch items-center text-sm text-ink-muted underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                >
                  Clear search
                </a>
              )}
            </form>
          </div>
        }
        methodology={
          <ExportProvenance
            exportState={exportState}
            powerBi={powerBi}
            asOf={view.asOfDate}
          />
        }
      />

      <Workspace>
        <GridRow>
          <Module
            id="deals"
            title="The transactions behind the aggregate"
            zone="deal"
            meta={
              <a
                href={detail ? withoutDetail : withDetail}
                className="inline-flex min-h-6 items-center underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
              >
                {detail
                  ? 'Hide unit, days, source and staff'
                  : 'Show unit, days, source and staff'}
              </a>
            }
          >
            {/*
              THE COUNT SITS ABOVE THE ROWS AS WELL AS BELOW THEM. It was only in the
              pagination footer, which put the answer to "how many matched" under the
              twenty-five rows it describes — so a reader adjusting a filter had to scroll
              past the result to find out how big it was.
            */}
            <p className="text-sm font-medium text-ink-secondary" role="status">
              {countLine}
            </p>

            <DealIndex
              route={ROUTE}
              filterQuery={linkContext}
              state={view.state}
              rows={view.rows}
              detail={detail}
            />

            <DealPagination
              route={ROUTE}
              filterQuery={linkContext}
              state={view.state}
              pageCount={view.pageCount}
              totalCount={view.totalCount}
              firstRowNumber={view.firstRowNumber}
              lastRowNumber={view.lastRowNumber}
            />

            <Text size="xs" tone="faint">
              A wholesale disposal or dealer trade is shown and labelled as not retail: it
              is a real transaction, and judging it by retail measures would be the error,
              not showing it. Each deal id opens its Deal Jacket: the transaction
              explained to the cent, with the cost components behind its front gross, its
              trade context, staff attribution, lead timeline and integrity checks.
            </Text>
          </Module>
        </GridRow>
      </Workspace>
    </Canvas>
  )
}

/** The first usable value of a raw query parameter. */
function firstValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null
  const first = Array.isArray(value) ? value[0] : value
  return first === undefined || first.length === 0 ? null : first
}

/**
 * The active query context as hidden inputs, so the search form preserves it.
 *
 * Rebuilt from the serialized string rather than from the filter object, so this can never
 * disagree with what the canonical serializer produces.
 */
function hiddenFields(context: string) {
  if (context === '') return null
  const pairs = context.split('&').map((part) => part.split('='))
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
