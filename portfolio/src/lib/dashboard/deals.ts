/**
 * The Deal Explorer's view model: search, filter, sort and pagination over the
 * governed deal-grain export.
 *
 * EVERY DEAL IS READ ON THE SERVER, AND NO DEAL IS SHIPPED TO THE BROWSER
 * -----------------------------------------------------------------------
 * The whole population is 650 rows across 18 partitions, and this module reads only
 * the partitions the store and period selection actually covers. What reaches the
 * browser is one page of rows already rendered into HTML: there is no client-side
 * dataset, no hydration payload of deals, and no request for more.
 *
 * SORTING AND PAGINATION ARE ROUTE-SPECIFIC URL PARAMETERS
 * --------------------------------------------------------
 * `sort`, `dir`, `page` and `q` are not part of the console-wide filter grammar in
 * `INFORMATION_ARCHITECTURE.md` §6, because they describe a presentation of a list
 * rather than a slice of the business. They are declared here as a route extension,
 * parsed with the same discipline -- closed vocabularies, invalid values reset with a
 * notice rather than throwing -- and they round-trip through the URL exactly like the
 * global ones, so browser back and forward remain the undo stack.
 *
 * EVERY SORT IS TOTAL
 * -------------------
 * A sort on a column with ties is not deterministic on its own, and a non-deterministic
 * sort makes pagination lose and repeat rows between pages. Every comparator falls
 * back to `sale_id`, which is unique, so the order is total and a page boundary is
 * stable.
 */
import type { DashboardRow } from '@/types/dashboard'

import type { Exact } from './decimal'
import { cellToExact, compareExact, sumExact } from './decimal'
import { dashboardStoreIds, dashboardStores, textCell, numericCell } from './data'
import { dealChunkFile } from './deal-chunks'
import type { DashboardFilters } from './filters'
import { formatCurrencyExact, formatIsoDate } from './format'
import { calendarWindow, resolvePeriod, type PeriodContext } from './periods'
import { dashboardCalendar, dashboardManifest } from './data'

/* -------------------------------------------------------------------------- */
/* Route-specific parameters                                                   */
/* -------------------------------------------------------------------------- */

/** The sortable columns. A closed vocabulary: anything else resets to the default. */
export const DEAL_SORT_KEYS = [
  'sale_date',
  'total_gross',
  'front_end_gross',
  'back_end_gross',
  'sale_price',
  'days_in_inventory_at_sale',
] as const
export type DealSortKey = (typeof DEAL_SORT_KEYS)[number]

export type SortDirection = 'asc' | 'desc'

/** Rows per page. Fixed rather than user-settable: a page-size control is state. */
export const DEALS_PER_PAGE = 25

export interface DealListState {
  readonly sort: DealSortKey
  readonly direction: SortDirection
  readonly page: number
  readonly query: string
}

export const DEFAULT_LIST_STATE: DealListState = {
  sort: 'sale_date',
  direction: 'desc',
  page: 1,
  query: '',
}

/** A rejected route parameter, reported to the reader rather than swallowed. */
export interface ListReset {
  readonly key: string
  readonly value: string
  readonly reason: string
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

/**
 * Parse the route's own parameters.
 *
 * `page` is validated against the vocabulary of positive integers only; whether it
 * is IN RANGE cannot be known until the rows are filtered, so an out-of-range page
 * is clamped later and reported there. Splitting it that way keeps this function a
 * pure parse.
 */
export function parseListState(query: Record<string, string | string[] | undefined>): {
  readonly state: DealListState
  readonly reset: readonly ListReset[]
} {
  const reset: ListReset[] = []
  let sort: DealSortKey = DEFAULT_LIST_STATE.sort
  let direction: SortDirection = DEFAULT_LIST_STATE.direction
  let page = DEFAULT_LIST_STATE.page

  const rawSort = firstValue(query.sort)
  if (rawSort !== undefined && rawSort !== '') {
    if ((DEAL_SORT_KEYS as readonly string[]).includes(rawSort)) {
      sort = rawSort as DealSortKey
    } else {
      reset.push({
        key: 'sort',
        value: rawSort,
        reason: `Expected one of ${DEAL_SORT_KEYS.join(', ')}.`,
      })
    }
  }

  const rawDirection = firstValue(query.dir)
  if (rawDirection !== undefined && rawDirection !== '') {
    if (rawDirection === 'asc' || rawDirection === 'desc') {
      direction = rawDirection
    } else {
      reset.push({ key: 'dir', value: rawDirection, reason: 'Expected asc or desc.' })
    }
  }

  const rawPage = firstValue(query.page)
  if (rawPage !== undefined && rawPage !== '') {
    if (/^[1-9][0-9]{0,4}$/.test(rawPage)) {
      page = Number(rawPage)
    } else {
      reset.push({
        key: 'page',
        value: rawPage,
        reason: 'Expected a whole number of 1 or more.',
      })
    }
  }

  const rawQuery = firstValue(query.q) ?? ''
  // Trimmed and length-capped. A search box is a text input, and an unbounded one in
  // a URL is a way to make a very large page out of a very small request.
  const searchQuery = rawQuery.trim().slice(0, 60)

  return { state: { sort, direction, page, query: searchQuery }, reset }
}

/** Serialize the route parameters, omitting defaults so a clean state is a clean URL. */
export function listStateQuery(state: DealListState): string {
  const parts: string[] = []
  if (state.query !== '') parts.push(`q=${encodeURIComponent(state.query)}`)
  if (state.sort !== DEFAULT_LIST_STATE.sort) parts.push(`sort=${state.sort}`)
  if (state.direction !== DEFAULT_LIST_STATE.direction)
    parts.push(`dir=${state.direction}`)
  if (state.page !== DEFAULT_LIST_STATE.page) parts.push(`page=${String(state.page)}`)
  return parts.join('&')
}

/* -------------------------------------------------------------------------- */
/* Reading the partitions                                                      */
/* -------------------------------------------------------------------------- */

const reportingCalendar = calendarWindow(dashboardCalendar, dashboardManifest.asOfDate)

function decode(file: {
  columns: readonly string[]
  rows: readonly (readonly unknown[])[]
}) {
  const rows: DashboardRow[] = []
  for (const values of file.rows) {
    const row: Record<string, unknown> = {}
    for (let index = 0; index < file.columns.length; index += 1) {
      const key = file.columns[index]
      if (key === undefined) continue
      row[key] = values[index] ?? null
    }
    rows.push(row as DashboardRow)
  }
  return rows
}

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The searchable fields, and only these.
 *
 * Searching a field the reader cannot see produces a result set they cannot explain,
 * so the four searched fields are all rendered in the row. Matching is
 * case-insensitive substring, which is what a manager hunting a stock number or a
 * model name expects; it is not fuzzy, because a search that matches things the
 * reader did not type is a search whose result cannot be predicted.
 */
const SEARCH_FIELDS = ['sale_id', 'vehicle_code', 'make', 'model_name'] as const

function matchesQuery(row: DashboardRow, needle: string): boolean {
  if (needle === '') return true
  const lowered = needle.toLowerCase()
  for (const field of SEARCH_FIELDS) {
    const value = row[field]
    if (typeof value === 'string' && value.toLowerCase().includes(lowered)) return true
  }
  return false
}

/* -------------------------------------------------------------------------- */
/* The rendered row                                                            */
/* -------------------------------------------------------------------------- */

export interface DealRow {
  readonly saleId: string
  readonly saleDate: string
  readonly saleDateDisplay: string
  readonly storeId: string
  readonly storeName: string
  readonly vehicleCode: string
  readonly vehicle: string
  readonly conditionType: string
  readonly saleType: string
  readonly isRetail: boolean
  readonly salePrice: string
  readonly frontGross: string
  readonly backGross: string
  readonly totalGross: string
  readonly isNegativeFrontGross: boolean
  readonly daysInInventory: number
  readonly leadSource: string | null
  readonly isLeadAttributed: boolean
  readonly salespersonCode: string | null
  readonly deskManagerCode: string | null
  readonly financeManagerCode: string | null
  readonly hasTrade: boolean
}

const STORE_NAMES: ReadonlyMap<string, string> = new Map(
  dashboardStores.map((store) => [store.id, store.shortName])
)

function toDealRow(row: DashboardRow): DealRow {
  const storeId = textCell(row, 'dealership_id')
  const front = cellToExact(numericCell(row, 'front_end_gross'))
  const back = cellToExact(numericCell(row, 'back_end_gross'))
  const total = cellToExact(numericCell(row, 'total_gross'))
  const price = cellToExact(numericCell(row, 'sale_price'))
  const days = numericCell(row, 'days_in_inventory_at_sale')
  const source = row.lead_source_name
  return {
    saleId: textCell(row, 'sale_id'),
    saleDate: textCell(row, 'sale_date'),
    saleDateDisplay: formatIsoDate(textCell(row, 'sale_date')),
    storeId,
    storeName: STORE_NAMES.get(storeId) ?? storeId,
    vehicleCode: textCell(row, 'vehicle_code'),
    vehicle: textCell(row, 'vehicle_display'),
    conditionType: textCell(row, 'condition_type'),
    saleType: textCell(row, 'sale_type'),
    isRetail: row.is_retail === true,
    salePrice: price === null ? '' : formatCurrencyExact(price),
    frontGross: front === null ? '' : formatCurrencyExact(front),
    backGross: back === null ? '' : formatCurrencyExact(back),
    totalGross: total === null ? '' : formatCurrencyExact(total),
    isNegativeFrontGross: row.is_negative_front_gross === true,
    daysInInventory: typeof days === 'number' ? days : Number(days ?? 0),
    leadSource: typeof source === 'string' ? source : null,
    isLeadAttributed: row.is_lead_attributed === true,
    salespersonCode:
      typeof row.salesperson_code === 'string' ? row.salesperson_code : null,
    deskManagerCode:
      typeof row.desk_manager_code === 'string' ? row.desk_manager_code : null,
    financeManagerCode:
      typeof row.finance_manager_code === 'string' ? row.finance_manager_code : null,
    hasTrade: row.has_trade === true,
  }
}

/* -------------------------------------------------------------------------- */
/* Sorting                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Compare two rows on the chosen column, with `sale_id` as the total-order fallback.
 *
 * Monetary columns are compared as EXACT DECIMALS, never as floats: `Number()` on a
 * gross figure is the one thing this console never does, and a comparator is not an
 * exception just because its output is an ordering rather than a displayed value.
 */
function comparator(sort: DealSortKey, direction: SortDirection) {
  const sign = direction === 'asc' ? 1 : -1
  return (a: DashboardRow, b: DashboardRow): number => {
    let result = 0
    if (sort === 'sale_date') {
      result = textCell(a, 'sale_date').localeCompare(textCell(b, 'sale_date'))
    } else if (sort === 'days_in_inventory_at_sale') {
      const left = Number(numericCell(a, sort) ?? 0)
      const right = Number(numericCell(b, sort) ?? 0)
      result = left === right ? 0 : left < right ? -1 : 1
    } else {
      const left = cellToExact(numericCell(a, sort))
      const right = cellToExact(numericCell(b, sort))
      result = left === null || right === null ? 0 : compareExact(left, right)
    }
    if (result !== 0) return result * sign
    // The tie-breaker is NOT reversed: it exists to make the order total, and
    // flipping it with the direction would reorder ties between pages.
    return textCell(a, 'sale_id').localeCompare(textCell(b, 'sale_id'))
  }
}

/* -------------------------------------------------------------------------- */
/* The view                                                                    */
/* -------------------------------------------------------------------------- */

export interface DealsView {
  readonly periodContext: PeriodContext
  readonly scopeLabel: string
  readonly storeIds: readonly string[]
  readonly state: DealListState
  readonly rows: readonly DealRow[]
  readonly totalCount: number
  readonly pageCount: number
  /** True when the requested page was past the end and was clamped to the last one. */
  readonly pageClamped: boolean
  readonly firstRowNumber: number
  readonly lastRowNumber: number
  readonly asOfDate: string
  /** Retail units and gross of the WHOLE filtered set, not just the visible page. */
  readonly retailCount: number
  /**
   * Front, back and total gross over the retail rows of the whole filtered set.
   *
   * `UX.2B` §15 asks the Deal Explorer to state what the filtered population IS before the
   * table lists it, so a desk manager can tell whether the filter they applied is the one they
   * meant. These are sums of exported deal-grain columns over the same rows the table pages
   * through — the same arithmetic `totalGrossDisplay` already did, over the same population,
   * for two more columns. No rate is formed from them here: a per-unit figure over this
   * population is `KPI-GRS-004`/`005`/`006` and `/dashboard/sales-gross` is the surface that
   * owns it.
   *
   * THE POPULATION IS THE RETAIL ROWS, NOT EVERY ROW. A wholesale disposal is a real
   * transaction and is listed in the table, with its sale type and a `not retail` mark; adding
   * its gross to a retail total would be the error the table's own note warns about.
   */
  readonly frontGrossDisplay: string | null
  readonly backGrossDisplay: string | null
  readonly totalGrossDisplay: string | null
  readonly negativeFrontCount: number
}

/**
 * Build the index.
 *
 * The order of operations is deliberate: read the covering partitions, apply the
 * global filters, apply the search, sort into a total order, THEN page. Paging before
 * sorting would produce a different page-one for the same query.
 */
export function buildDeals(filters: DashboardFilters, state: DealListState): DealsView {
  const periodContext = resolvePeriod(filters.period, 'none', reportingCalendar)
  const period = periodContext.period
  const storeIds = filters.store.length === 0 ? dashboardStoreIds : filters.store

  const collected: DashboardRow[] = []
  for (const store of storeIds) {
    for (const month of period.months) {
      const file = dealChunkFile(store, month)
      if (file === undefined) continue
      for (const row of decode(file)) {
        const date = textCell(row, 'sale_date')
        if (date < period.start || date > period.end) continue
        if (filters.condition !== null) {
          const type = textCell(row, 'condition_type')
          const group = textCell(row, 'condition_group')
          if (filters.condition === 'Certified') {
            if (type !== 'Certified') continue
          } else if (group !== filters.condition) continue
        }
        if (filters.scope !== 'combined' && !matchesScope(row, filters.scope)) continue
        if (filters.source !== null) {
          // A deal with no linked lead is walk-in business, not a deal from an
          // unknown source, and it is excluded when a source is asked for.
          if (row.lead_source_code !== filters.source) continue
        }
        if (filters.make !== null && !equalsIgnoringCase(row.make, filters.make)) continue
        if (
          filters.model !== null &&
          !equalsIgnoringCase(row.model_name, filters.model)
        ) {
          continue
        }
        if (!matchesQuery(row, state.query)) continue
        collected.push(row)
      }
    }
  }

  collected.sort(comparator(state.sort, state.direction))

  const totalCount = collected.length
  const pageCount = Math.max(1, Math.ceil(totalCount / DEALS_PER_PAGE))
  const clampedPage = Math.min(state.page, pageCount)
  const pageClamped = clampedPage !== state.page
  const start = (clampedPage - 1) * DEALS_PER_PAGE
  const visible = collected.slice(start, start + DEALS_PER_PAGE)

  const retailRows = collected.filter((row) => row.is_retail === true)
  /** One exported money column, summed over the retail rows, or null when none carries it. */
  const retailSum = (column: string): Exact | null => {
    const values = retailRows
      .map((row) => cellToExact(numericCell(row, column)))
      .filter((value): value is Exact => value !== null)
    return values.length === 0 ? null : sumExact(values)
  }
  const frontGross = retailSum('front_end_gross')
  const backGross = retailSum('back_end_gross')
  const totalGross = retailSum('total_gross')

  return {
    periodContext,
    scopeLabel:
      filters.store.length === 0
        ? 'Granite Auto Group, all three stores'
        : dashboardStores
            .filter((store) => storeIds.includes(store.id))
            .map((store) => store.shortName)
            .join(', '),
    storeIds,
    state: { ...state, page: clampedPage },
    rows: visible.map(toDealRow),
    totalCount,
    pageCount,
    pageClamped,
    firstRowNumber: totalCount === 0 ? 0 : start + 1,
    lastRowNumber: Math.min(start + DEALS_PER_PAGE, totalCount),
    asOfDate: dashboardManifest.asOfDate,
    retailCount: retailRows.length,
    frontGrossDisplay: frontGross === null ? null : formatCurrencyExact(frontGross),
    backGrossDisplay: backGross === null ? null : formatCurrencyExact(backGross),
    totalGrossDisplay: totalGross === null ? null : formatCurrencyExact(totalGross),
    negativeFrontCount: collected.filter((row) => row.is_negative_front_gross === true)
      .length,
  }
}

function equalsIgnoringCase(value: unknown, expected: string): boolean {
  return typeof value === 'string' && value.toLowerCase() === expected.toLowerCase()
}

/**
 * The `scope` parameter against a deal's sale type.
 *
 * `new` and `used` are condition scopes in the console grammar and are matched on the
 * condition group, because a lease of a new car is a new unit. The rest map to a sale
 * type directly.
 */
function matchesScope(row: DashboardRow, scope: string): boolean {
  const saleType = textCell(row, 'sale_type')
  const group = textCell(row, 'condition_group')
  const conditionType = textCell(row, 'condition_type')
  switch (scope) {
    case 'new':
      return row.is_retail === true && group === 'New'
    case 'used':
      return row.is_retail === true && group === 'Used'
    case 'certified':
      return conditionType === 'Certified'
    case 'lease':
      return saleType === 'Lease'
    case 'wholesale':
      return saleType === 'Wholesale'
    case 'dealer-trade':
      return saleType === 'Dealer Trade'
    default:
      return true
  }
}
