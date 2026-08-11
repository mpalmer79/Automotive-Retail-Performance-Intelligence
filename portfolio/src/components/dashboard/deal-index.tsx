/**
 * The Deal Explorer's index: a table on wide screens, stacked cards below.
 *
 * WHAT `UX.2B` CHANGED, AND WHAT IT DID NOT
 * -----------------------------------------
 * The table carried thirteen columns of equal weight, three of which answer a question a
 * reader asks AFTER they have found the deal: which unit it was, where the lead came from and
 * who worked it. `UX.2B` §16 asks for the transaction economics first and the rest through a
 * disclosure, so the ten money-and-identity columns stay in the table and the three move into
 * a second table underneath it, keyed on the same deal id, in the same order, for the same
 * page of rows. Nothing was dropped: `<details>` keeps that table in the document, in the
 * accessibility tree's reading order and in a browser text search, and it is the same
 * `DealRow` fields rendered by the same component.
 *
 * The mobile cards were already the deliberate transaction pattern §18 asks for and are
 * unchanged apart from carrying the drill-through on the deal id, which the table had and the
 * card did not.
 *
 * EXACTLY ONE REPRESENTATION IS IN THE ACCESSIBILITY TREE
 * -------------------------------------------------------
 * The established 1280px pattern: both markups exist in the document, and each is
 * `hidden` at the other's widths. `hidden` removes an element from the accessibility
 * tree as well as from the page, so a screen-reader user meets one representation
 * rather than hearing all 25 deals twice. A CSS-only hide would not do that.
 *
 * SORTING IS LINKS, NOT SCRIPT
 * ----------------------------
 * Each sortable column header is an anchor to the same route with a different `sort`
 * and `dir`. That makes sorting work with JavaScript disabled, makes each sorted view
 * a real URL a reader can share, and puts every state in browser history. `aria-sort`
 * on the header cell announces the current column and direction.
 *
 * THE DEAL ID IS THE DRILL-THROUGH
 * --------------------------------
 * `DASH.3` rendered it as TEXT, because `/dashboard/deals/[saleId]` did not exist and
 * an anchor to it would have been a link to a 404. `DASH.4` delivers that route, so
 * the id becomes a link -- in the same diff that makes the destination real, which is
 * the only order in which it is honest to do it.
 *
 * The link is the deal id itself rather than a "view" affordance beside it: the id is
 * what a manager is looking for, and making it the target means the thing they read
 * and the thing they click are the same thing.
 */
import { Text } from '@/components/ui/typography'
import type {
  DealRow,
  DealListState,
  DealSortKey,
  SortDirection,
} from '@/lib/dashboard/deals'
import { listStateQuery } from '@/lib/dashboard/deals'
import { cx } from '@/lib/utils'

/** A sortable column: its key, its heading, and how its values are aligned. */
interface SortableColumn {
  readonly key: DealSortKey
  readonly label: string
  readonly numeric: boolean
}

const SORTABLE: readonly SortableColumn[] = [
  { key: 'sale_date', label: 'Sale date', numeric: false },
  { key: 'sale_price', label: 'Sale price', numeric: true },
  { key: 'front_end_gross', label: 'Front gross', numeric: true },
  { key: 'back_end_gross', label: 'Back gross', numeric: true },
  { key: 'total_gross', label: 'Total gross', numeric: true },
  { key: 'days_in_inventory_at_sale', label: 'Days', numeric: true },
]

/** The href that sorts by a column, toggling direction when it is already active. */
function sortHref(
  route: string,
  filterQuery: string,
  state: DealListState,
  key: DealSortKey
): string {
  const active = state.sort === key
  // A new column starts descending for money and days (the interesting end first)
  // and ascending for the date. Toggling an active column reverses it.
  const nextDirection: SortDirection = active
    ? state.direction === 'asc'
      ? 'desc'
      : 'asc'
    : key === 'sale_date'
      ? 'desc'
      : 'desc'
  // Sorting always returns to page one: staying on page 7 of a different order shows
  // a reader rows they did not ask for and cannot explain.
  const listQuery = listStateQuery({
    ...state,
    sort: key,
    direction: nextDirection,
    page: 1,
  })
  const parts = [filterQuery, listQuery].filter((part) => part !== '')
  return parts.length === 0 ? route : `${route}?${parts.join('&')}`
}

function ariaSort(
  state: DealListState,
  key: DealSortKey
): 'ascending' | 'descending' | 'none' {
  if (state.sort !== key) return 'none'
  return state.direction === 'asc' ? 'ascending' : 'descending'
}

function SortLink({
  route,
  filterQuery,
  state,
  column,
}: {
  readonly route: string
  readonly filterQuery: string
  readonly state: DealListState
  readonly column: SortableColumn
}) {
  const active = state.sort === column.key
  return (
    <a
      href={sortHref(route, filterQuery, state, column.key)}
      className={cx(
        'inline-flex min-h-6 items-center gap-1 underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent',
        active ? 'text-ink underline decoration-accent' : 'text-ink-muted'
      )}
    >
      {column.label}
      {/* Direction is a glyph AND is announced by aria-sort on the cell. It is never
          conveyed by colour alone. */}
      {active ? (
        <span aria-hidden="true">{state.direction === 'asc' ? '↑' : '↓'}</span>
      ) : null}
    </a>
  )
}

/** The words a role with no attribution renders. Absence is stated, not blank. */
function StaffCode({ code }: { readonly code: string | null }) {
  return <>{code ?? <span className="text-ink-faint">Unattributed</span>}</>
}

export interface DealIndexProps {
  readonly route: string
  /** The global filter query string, so a sort link preserves the filter context. */
  readonly filterQuery: string
  readonly state: DealListState
  readonly rows: readonly DealRow[]
}

export function DealIndex({ route, filterQuery, state, rows }: DealIndexProps) {
  return (
    <>
      {/* -------------------------------------------------------------- */}
      {/* Wide: a semantic table                                          */}
      {/* -------------------------------------------------------------- */}
      <div className="hidden overflow-x-auto min-[1280px]:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Finalized transactions matching the current filters, one row per deal.
          </caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Deal
              </th>
              <th
                scope="col"
                aria-sort={ariaSort(state, 'sale_date')}
                className="py-2 pr-3 font-medium"
              >
                <SortLink
                  route={route}
                  filterQuery={filterQuery}
                  state={state}
                  column={SORTABLE[0] as SortableColumn}
                />
              </th>
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Store
              </th>
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Vehicle
              </th>
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Sale type
              </th>
              {SORTABLE.slice(1).map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort(state, column.key)}
                  className="py-2 pr-3 text-right font-medium"
                >
                  <SortLink
                    route={route}
                    filterQuery={filterQuery}
                    state={state}
                    column={column}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.saleId}
                className="border-b border-line-subtle/60 last:border-0"
              >
                <th scope="row" className="numeric py-2 pr-3 font-normal">
                  <a
                    href={`${route}/${row.saleId}`}
                    className="inline-flex min-h-6 items-center text-ink underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                  >
                    {row.saleId}
                  </a>
                </th>
                <td className="py-2 pr-3 text-ink-secondary">{row.saleDateDisplay}</td>
                <td className="py-2 pr-3 text-ink-secondary">{row.storeName}</td>
                <td className="py-2 pr-3 text-ink">
                  {row.vehicle}
                  <span className="ml-1.5 text-xs text-ink-faint">
                    {row.conditionType}
                  </span>
                </td>
                <td className="py-2 pr-3 text-ink-secondary">
                  {row.saleType}
                  {row.isRetail ? null : (
                    <span className="ml-1.5 text-xs text-ink-faint">not retail</span>
                  )}
                </td>
                <td className="numeric py-2 pr-3 text-right text-ink">{row.salePrice}</td>
                <td className="numeric py-2 pr-3 text-right text-ink">
                  {row.frontGross}
                  {/* A negative front is marked in WORDS as well as by its sign, so
                      the fact survives a reader skimming the column. */}
                  {row.isNegativeFrontGross ? (
                    <span className="ml-1.5 text-xs text-ink-faint">loss</span>
                  ) : null}
                </td>
                <td className="numeric py-2 pr-3 text-right text-ink">{row.backGross}</td>
                <td className="numeric py-2 pr-3 text-right font-semibold text-ink">
                  {row.totalGross}
                </td>
                <td className="numeric py-2 text-right text-ink-secondary">
                  {row.daysInInventory}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* -------------------------------------------------------------- */}
      {/* Narrow: stacked cards                                           */}
      {/* -------------------------------------------------------------- */}
      <ul className="flex flex-col gap-3 min-[1280px]:hidden">
        {rows.map((row) => (
          <li
            key={row.saleId}
            className="flex flex-col gap-2 rounded-lg border border-line-subtle bg-surface p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              {/* THE DRILL-THROUGH IS ON THE CARD TOO. The table's deal id has been a link
                  since `DASH.4` and the card's was plain text, so a phone reader could see a
                  deal and not open it. `UX.2B` §18 asks for drill-through without excessive
                  interaction; the id is the target for the reason the table records — the
                  thing they read and the thing they tap are the same thing. */}
              <a
                href={`${route}/${row.saleId}`}
                className="numeric inline-flex min-h-touch items-center text-sm font-semibold text-ink underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
              >
                {row.saleId}
              </a>
              <span className="text-xs text-ink-muted">{row.saleDateDisplay}</span>
            </div>
            <div className="text-sm text-ink">{row.vehicle}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
              <span>{row.storeName}</span>
              <span className="numeric">{row.vehicleCode}</span>
              <span>{row.conditionType}</span>
              <span>{row.saleType}</span>
              {row.hasTrade ? <span>Trade</span> : null}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <div className="flex flex-col">
                <dt className="text-xs text-ink-muted">Sale price</dt>
                <dd className="numeric text-ink">{row.salePrice}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-ink-muted">Front</dt>
                <dd className="numeric text-ink">
                  {row.frontGross}
                  {row.isNegativeFrontGross ? (
                    <span className="ml-1 text-xs text-ink-faint">loss</span>
                  ) : null}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-ink-muted">Back</dt>
                <dd className="numeric text-ink">{row.backGross}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-ink-muted">Total</dt>
                <dd className="numeric font-semibold text-ink">{row.totalGross}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
              <span>
                {row.isLeadAttributed
                  ? `Source: ${row.leadSource ?? ''}`
                  : 'Walk-in or unattributed'}
              </span>
              <span className="numeric">
                Salesperson: <StaffCode code={row.salespersonCode} />
              </span>
              <span>{row.daysInInventory} days in stock</span>
            </div>
          </li>
        ))}
      </ul>

      {/* -------------------------------------------------------------- */}
      {/* The attribution and provenance columns, on demand               */}
      {/* -------------------------------------------------------------- */}
      {/*
        WIDE SCREENS ONLY, because the cards below 1280px already carry all three fields
        inline. Rendering it at every width would put the same twenty-five deals in the
        accessibility tree twice, which is the defect the two-representation rule at the
        head of this file exists to prevent.

        NOT SORTABLE, DELIBERATELY. `UX.2B` §17 forbids a sort that accidentally becomes an
        employee leaderboard, and a salesperson column with a sort control on it is exactly
        that. The column is context for a deal a reader has already chosen, in the table's
        current order, and there is no control here to reorder the roster by anything.
      */}
      {rows.length === 0 ? null : (
        <details className="hidden rounded-xl border border-line-subtle bg-surface-sunken/40 min-[1280px]:block">
          <summary className="flex min-h-touch cursor-pointer items-center px-3 text-sm font-medium text-ink-secondary transition-colors duration-(--arpi-motion-fast) hover:text-accent">
            Unit, lead source and attribution for these deals
          </summary>
          <div className="overflow-x-auto px-3 pb-3">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Unit identifier, lead source and staff attribution for the deals listed
                above, in the same order. Synthetic employee codes; no name exists
                anywhere in ARPI.
              </caption>
              <thead>
                <tr className="border-b border-line-subtle text-left">
                  <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                    Deal
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                    Unit
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                    Lead source
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                    Salesperson
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                    Desk
                  </th>
                  <th scope="col" className="py-2 font-medium text-ink-muted">
                    Finance
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.saleId}
                    className="border-b border-line-subtle/60 last:border-0"
                  >
                    <th scope="row" className="numeric py-1.5 pr-3 font-normal">
                      <a
                        href={`${route}/${row.saleId}`}
                        className="inline-flex min-h-6 items-center text-ink-secondary underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                      >
                        {row.saleId}
                      </a>
                    </th>
                    <td className="numeric py-1.5 pr-3 text-ink-secondary">
                      {row.vehicleCode}
                    </td>
                    <td className="py-1.5 pr-3 text-ink-secondary">
                      {row.isLeadAttributed ? (
                        row.leadSource
                      ) : (
                        <span className="text-ink-faint">Walk-in or unattributed</span>
                      )}
                    </td>
                    <td className="numeric py-1.5 pr-3 text-xs text-ink-secondary">
                      <StaffCode code={row.salespersonCode} />
                    </td>
                    <td className="numeric py-1.5 pr-3 text-xs text-ink-secondary">
                      <StaffCode code={row.deskManagerCode} />
                    </td>
                    <td className="numeric py-1.5 text-xs text-ink-secondary">
                      <StaffCode code={row.financeManagerCode} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {rows.length === 0 ? (
        <Text size="sm" tone="muted">
          No finalized transaction matches this combination.
        </Text>
      ) : null}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

export interface PaginationProps {
  readonly route: string
  readonly filterQuery: string
  readonly state: DealListState
  readonly pageCount: number
  readonly totalCount: number
  readonly firstRowNumber: number
  readonly lastRowNumber: number
}

/**
 * Previous and next as real links, plus a stated position.
 *
 * No page-number strip: with 26 pages it becomes a row of tiny targets, and the two
 * controls a reader actually uses are the two either side of where they are. The
 * position sentence is what tells them where that is.
 */
export function DealPagination({
  route,
  filterQuery,
  state,
  pageCount,
  totalCount,
  firstRowNumber,
  lastRowNumber,
}: PaginationProps) {
  const href = (page: number) => {
    const listQuery = listStateQuery({ ...state, page })
    const parts = [filterQuery, listQuery].filter((part) => part !== '')
    return parts.length === 0 ? route : `${route}?${parts.join('&')}`
  }
  const hasPrevious = state.page > 1
  const hasNext = state.page < pageCount

  return (
    <nav
      aria-label="Deal index pages"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"
    >
      <Text size="sm" tone="muted">
        {totalCount === 0
          ? 'No deals to show.'
          : `Showing ${String(firstRowNumber)} to ${String(lastRowNumber)} of ${String(totalCount)} deals, page ${String(state.page)} of ${String(pageCount)}.`}
      </Text>
      <div className="flex items-center gap-2">
        {hasPrevious ? (
          <a
            href={href(state.page - 1)}
            rel="prev"
            className="inline-flex min-h-touch items-center rounded-md border border-line-subtle px-3 text-sm text-ink transition-colors duration-(--arpi-motion-fast) hover:border-accent hover:text-accent"
          >
            Previous
          </a>
        ) : (
          <span className="inline-flex min-h-touch items-center rounded-md border border-line-subtle/50 px-3 text-sm text-ink-faint">
            Previous
          </span>
        )}
        {hasNext ? (
          <a
            href={href(state.page + 1)}
            rel="next"
            className="inline-flex min-h-touch items-center rounded-md border border-line-subtle px-3 text-sm text-ink transition-colors duration-(--arpi-motion-fast) hover:border-accent hover:text-accent"
          >
            Next
          </a>
        ) : (
          <span className="inline-flex min-h-touch items-center rounded-md border border-line-subtle/50 px-3 text-sm text-ink-faint">
            Next
          </span>
        )}
      </div>
    </nav>
  )
}
