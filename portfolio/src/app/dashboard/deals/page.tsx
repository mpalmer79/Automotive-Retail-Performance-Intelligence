import type { Metadata } from 'next'

import { Canvas } from '@/components/shell/field'
import { DealIndex, DealPagination } from '@/components/dashboard/deal-index'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import {
  FilterNotice,
  PeriodNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
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
import { buildDeals, parseListState } from '@/lib/dashboard/deals'
import {
  activeFilterChips,
  DEAL_EXPLORER_SUPPORT,
  parseFilters,
  serializeFilters,
  type QueryInput,
} from '@/lib/dashboard/filters'
import { formatIsoDate, formatIsoMonth } from '@/lib/dashboard/format'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardDeals')

const ROUTE = ROUTES.dashboardDeals.href

/**
 * The Deal Explorer — every finalized transaction behind the aggregates.
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
  const filterQuery = serializeFilters(parsed.filters)

  return (
    <Canvas>
      <PageHeader
        eyebrow="Dealer Operations Command Center"
        title="Every finalized transaction, and what each one made"
        crumbLabel="Deal Explorer"
        lede={`${String(view.totalCount)} finalized transactions for ${view.scopeLabel.toLowerCase()}, over ${view.periodContext.period.label}. Searchable by deal, unit, make and model. Every figure is the deal's own exported value.`}
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
      {/* Context, search and filters                                         */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="none" tone="evidence" className="py-section-tight" id="context">
        <Container width="full">
          <div className="flex flex-col gap-6">
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

            {chips.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {chips.map((chip) => (
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
              conditionHint="Selects deals by the vehicle's condition."
              leadSourceHint="Selects deals with a linked lead from that source. Walk-in deals are excluded when a source is chosen."
            />
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* The index                                                           */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="default" id="deals">
        <Container width="full">
          <SectionHeader
            eyebrow="Deal index"
            title="The transactions behind the aggregate"
            lede="Sorted by any money column or by days in stock, always with the deal id as a tie-breaker so a page boundary is stable. A wholesale disposal or dealer trade is shown and labelled as not retail: it is a real transaction, and judging it by retail measures would be the error, not showing it."
          />
          <div className="flex flex-col gap-5 pt-6">
            <dl className="grid gap-4 border-y border-line py-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  Deals in scope
                </dt>
                <dd className="numeric text-lg font-semibold text-ink">
                  {view.totalCount}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  Retail units
                </dt>
                <dd className="numeric text-lg font-semibold text-ink">
                  {view.retailCount}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  Retail total gross
                </dt>
                <dd className="numeric text-lg font-semibold text-ink">
                  {view.totalGrossDisplay ?? 'No matching records'}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  Negative front
                </dt>
                <dd className="numeric text-lg font-semibold text-ink">
                  {view.negativeFrontCount}
                </dd>
              </div>
            </dl>

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
        </Container>
      </Section>
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
