/**
 * The server-owned data-access layer for the console.
 *
 * ONE DOOR
 * --------
 * Every figure `/dashboard` renders comes through this module, and nothing else in
 * `src/` imports `@/generated/dashboard/*`. That is the shape ADR-0013 conditions
 * 8–10 and 15 need: there is no database client, no credential, no query and no
 * runtime connection anywhere in the frontend, because the only data that exists is
 * a build-packaged export produced by `arpi_reporter` against `reporting` views —
 * and one module is a boundary a test can stand on. The whole-dataset files are
 * imported at module scope; the chunked ones come from `chunks.ts`, which is a
 * static table for the tracing reason recorded there.
 *
 * WHAT IT DOES AND DOES NOT DO
 * ----------------------------
 * It rehydrates the columnar files into row objects, and it SELECTS rows: by date,
 * by store, by condition group, by lead source. It does not add anything up. Every
 * aggregation in the console is declared in `selectors.ts` against the export's own
 * governed metadata, because a helper here that happened to sum a column would be
 * the first step toward a second KPI engine, and ADR-0013 condition 2 exists to
 * prevent exactly that.
 *
 * NOTHING HERE IS SENT TO A BROWSER. Server components read it; client islands get
 * small, already-selected props.
 */
import calendarFile from '@/generated/dashboard/datasets/calendar.json'
import grossSummaryFile from '@/generated/dashboard/datasets/gross-summary.json'
import inventoryTurnFile from '@/generated/dashboard/datasets/inventory-turn.json'
import leadSourcesFile from '@/generated/dashboard/datasets/lead-sources.json'
import salesSummaryFile from '@/generated/dashboard/datasets/sales-summary.json'
import storesFile from '@/generated/dashboard/datasets/stores.json'
import clientManifest from '@/generated/dashboard/manifest.json'
import type {
  DashboardCell,
  DashboardClientDataset,
  DashboardClientManifest,
  DashboardDatasetFile,
  DashboardRow,
} from '@/types/dashboard'

import type { ChunkedDatasetName } from './chunks'
import { chunkFile } from './chunks'

/* -------------------------------------------------------------------------- */
/* The manifest                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The client-safe manifest.
 *
 * Cast through `unknown` rather than asserted onto: TypeScript's JSON module type
 * is structural and widened, and the runtime validation that makes this shape
 * trustworthy already ran — twice — in `generate-dashboard-data.ts` and in
 * `dashboard-data.test.ts`, against the root export and the committed bytes. A
 * third narrowing here would be ceremony, and the trust panel renders the
 * manifest's own status fields rather than assuming them.
 */
export const dashboardManifest = clientManifest as unknown as DashboardClientManifest

/** One dataset's manifest entry. Throws: an absent dataset is a build error, not a branch. */
export function datasetManifest(name: string): DashboardClientDataset {
  const found = dashboardManifest.datasets.find((dataset) => dataset.name === name)
  if (found === undefined) {
    throw new Error(`The dashboard manifest declares no dataset "${name}".`)
  }
  return found
}

/* -------------------------------------------------------------------------- */
/* Rehydration                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Columnar file to row objects.
 *
 * `DashboardDatasetFile` is `{ columns, rows: [[…]] }`, which saved five megabytes
 * against repeating seventeen key names on sixteen thousand rows. Callers want
 * objects, so this is where the key names go back on — once per dataset, memoized,
 * rather than once per read.
 */
const rowCache = new Map<
  string,
  { readonly file: DashboardDatasetFile; readonly rows: readonly DashboardRow[] }
>()

/**
 * Rehydrate a columnar dataset file, memoized by key.
 *
 * Exported so a ROUTE-SCOPED data module can decode its own generated files without
 * importing them through this one. That distinction matters: an import here is an
 * edge in the graph of every route that reads this module, so a dataset only one
 * route needs is imported by a module only that route reads, and shares this
 * decoder rather than duplicating it. See `deal-chunks.ts` and `sales-gross-data.ts`.
 */
export function decodeDataset(
  cacheKey: string,
  file: DashboardDatasetFile
): readonly DashboardRow[] {
  return toRows(cacheKey, file)
}

function toRows(cacheKey: string, file: DashboardDatasetFile): readonly DashboardRow[] {
  const cached = rowCache.get(cacheKey)
  if (cached !== undefined) {
    // A KEY COLLISION IS AN ERROR, NOT A CACHE HIT.
    //
    // Every partitioned file has the same columns and the same shape, so a caller that
    // passes the dataset name for all of its partitions gets the FIRST partition's rows
    // back for every one of them, and nothing about the result looks wrong: right columns,
    // plausible rows, wrong store. That defect shipped on `/dashboard/inventory`, which
    // rendered one store's 96 units three times and reported 288.
    //
    // Identity is the fact that settles it. Each generated file is a module-level object,
    // so two different partitions can never be the same reference. Presenting one key with
    // two files now fails loudly at the first render rather than answering confidently and
    // incorrectly for the life of the process.
    if (cached.file !== file) {
      throw new Error(
        `Two different dataset files were decoded under the cache key "${cacheKey}". ` +
          'A partitioned dataset needs one key per partition (dataset/store/month), ' +
          'not one key per dataset.'
      )
    }
    return cached.rows
  }
  const columns = file.columns
  const rows = file.rows.map((values) => {
    const row: Record<string, DashboardCell> = {}
    for (let index = 0; index < columns.length; index += 1) {
      const key = columns[index]
      if (key === undefined) continue
      row[key] = values[index] ?? null
    }
    return row as DashboardRow
  })
  rowCache.set(cacheKey, { file, rows })
  return rows
}

/**
 * The unchunked datasets the console currently reads.
 *
 * Six of the twelve, and the omissions are deliberate. An import here is a graph
 * edge: the bundler inlines the file into the server chunk whether or not anything
 * reads it, so importing `marketing-performance.json` "for later" would put 79 kB of
 * campaign data into every build to be summed by nothing. `campaigns`,
 * `days-to-sale`, `appointment-funnel`, `marketing-performance`,
 * `reconciliation-status` and `pipeline-run` arrive with the pages that need them -
 * the sales and gross page, the leads and marketing page, and the routes that show a
 * per-reconciliation detail rather than the manifest's summary of it.
 *
 * The lane still carries all seventeen: they are exported, validated, hashed and
 * committed. This is a statement about what one route reads, not about what exists.
 */
const WHOLE_FILES: Readonly<Record<string, unknown>> = {
  stores: storesFile,
  calendar: calendarFile,
  'lead-sources': leadSourcesFile,
  'sales-summary': salesSummaryFile,
  'gross-summary': grossSummaryFile,
  'inventory-turn': inventoryTurnFile,
}

/** Every row of an unchunked dataset. */
export function wholeDataset(name: string): readonly DashboardRow[] {
  const file = WHOLE_FILES[name]
  if (file === undefined) {
    throw new Error(`"${name}" is not an unchunked dataset this route carries.`)
  }
  return toRows(name, file as unknown as DashboardDatasetFile)
}

/**
 * The rows of a chunked dataset for the given stores and months.
 *
 * Reads only the partitions the filter context asks for. The default view touches
 * six of eighteen partitions per dataset — the selected month and the comparison
 * month, across three stores.
 */
export function chunkedDataset(
  name: ChunkedDatasetName,
  stores: readonly string[],
  months: readonly string[]
): readonly DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const store of stores) {
    for (const month of months) {
      const file = chunkFile(name, store, month)
      if (file === undefined) continue
      rows.push(...toRows(`${name}/${store}/${month}`, file))
    }
  }
  return rows
}

/* -------------------------------------------------------------------------- */
/* Cell readers                                                                */
/* -------------------------------------------------------------------------- */

/** A required text cell. */
export function textCell(row: DashboardRow, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') {
    throw new Error(`Column "${column}" is not text on this row.`)
  }
  return value
}

/** A cell that may be null: currency, ratio, count or order statistic. */
export function numericCell(row: DashboardRow, column: string): string | number | null {
  const value = row[column]
  if (value === undefined) throw new Error(`No column "${column}" on this row.`)
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  throw new Error(`Column "${column}" is not numeric on this row.`)
}

/* -------------------------------------------------------------------------- */
/* The store dimension                                                         */
/* -------------------------------------------------------------------------- */

export interface DashboardStore {
  readonly id: string
  readonly name: string
  readonly shortName: string
  readonly storeType: string
  readonly brandLabel: string
  readonly isFranchise: boolean
  readonly locationLabel: string
}

/**
 * The three stores, in business-code order.
 *
 * `isFranchise` is the field the scoreboard's "Not applicable" rule turns on, and
 * it is read from the export rather than inferred from a name: the independent
 * pre-owned centre has no new-vehicle franchise, so its new-vehicle cells are
 * structurally absent rather than measured at zero, and that distinction has to
 * come from the data or it is an assumption.
 */
export const dashboardStores: readonly DashboardStore[] = wholeDataset('stores')
  .map((row) => ({
    id: textCell(row, 'dealership_id'),
    name: textCell(row, 'store_name'),
    shortName: textCell(row, 'store_short_name'),
    storeType: textCell(row, 'store_type'),
    brandLabel: textCell(row, 'brand_label'),
    isFranchise: row.is_franchise_store === true,
    locationLabel: textCell(row, 'location_label'),
  }))
  .sort((a, b) => a.id.localeCompare(b.id))

export const dashboardStoreIds: readonly string[] = dashboardStores.map(
  (store) => store.id
)

export function storeById(id: string): DashboardStore | undefined {
  return dashboardStores.find((store) => store.id === id)
}

/* -------------------------------------------------------------------------- */
/* The lead-source dimension                                                   */
/* -------------------------------------------------------------------------- */

export interface DashboardLeadSource {
  readonly code: string
  readonly name: string
  readonly category: string
}

export const dashboardLeadSources: readonly DashboardLeadSource[] = wholeDataset(
  'lead-sources'
)
  .map((row) => ({
    code: textCell(row, 'lead_source_code'),
    name: textCell(row, 'lead_source_name'),
    category: textCell(row, 'source_category'),
  }))
  .sort((a, b) => a.code.localeCompare(b.code))

export const dashboardLeadSourceCodes: readonly string[] = dashboardLeadSources.map(
  (source) => source.code
)

/* -------------------------------------------------------------------------- */
/* The condition groups                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The condition groups the export actually carries.
 *
 * Read from the manifest's declared enumeration rather than typed here.
 * `INFORMATION_ARCHITECTURE.md` §6 lists `Certified` as part of the console-wide
 * filter grammar, and the parser accepts it for that reason - but the warehouse
 * models New and Used only, so offering `Certified` on a control would be offering
 * a filter that can never match a row. The grammar is the contract; the control
 * offers what the data has.
 */
export const dashboardConditionGroups: readonly string[] = [
  ...new Set(
    dashboardManifest.datasets.flatMap((dataset) =>
      dataset.columns
        .filter((column) => column.name === 'condition_group')
        .flatMap((column) => column.enumeration ?? [])
    )
  ),
].sort()

/* -------------------------------------------------------------------------- */
/* The calendar                                                                */
/* -------------------------------------------------------------------------- */

export interface CalendarDay {
  readonly date: string
  readonly monthStart: string
  readonly yearMonthLabel: string
  readonly isSellingDay: boolean
}

/**
 * The reporting window's calendar, exported once.
 *
 * `DATA_CONTRACT.md` §6: period filters resolve against this dataset's fields "so
 * the console and the warehouse cannot disagree about which days a month contains
 * or which of them a showroom was open". Nothing in the console constructs a date
 * from the wall clock.
 */
export const dashboardCalendar: readonly CalendarDay[] = wholeDataset('calendar')
  .map((row) => ({
    date: textCell(row, 'calendar_date'),
    monthStart: textCell(row, 'month_start_date'),
    yearMonthLabel: textCell(row, 'year_month_label'),
    isSellingDay: row.is_selling_day === true,
  }))
  .sort((a, b) => a.date.localeCompare(b.date))

/** The first and last dates the export covers. */
export const calendarBounds: { readonly first: string; readonly last: string } = {
  first: dashboardCalendar[0]?.date ?? dashboardManifest.asOfDate,
  last:
    dashboardCalendar[dashboardCalendar.length - 1]?.date ?? dashboardManifest.asOfDate,
}

/** Every `YYYY-MM` the export covers, ascending. */
export const calendarMonths: readonly string[] = [
  ...new Set(dashboardCalendar.map((day) => day.date.slice(0, 7))),
].sort()

/* -------------------------------------------------------------------------- */
/* Row selection                                                               */
/* -------------------------------------------------------------------------- */

export interface RowFilter {
  /** The dataset's own date column. */
  readonly dateColumn?: string
  readonly start?: string
  readonly end?: string
  readonly stores?: readonly string[]
  readonly conditionGroups?: readonly string[]
  readonly leadSources?: readonly string[]
}

/** Select rows. Selection only: no column is read for its value here. */
export function selectRows(
  rows: readonly DashboardRow[],
  filter: RowFilter
): readonly DashboardRow[] {
  return rows.filter((row) => {
    if (filter.dateColumn !== undefined) {
      const value = row[filter.dateColumn]
      if (typeof value !== 'string') return false
      if (filter.start !== undefined && value < filter.start) return false
      if (filter.end !== undefined && value > filter.end) return false
    }
    if (filter.stores !== undefined && filter.stores.length > 0) {
      const store = row.dealership_id
      if (typeof store !== 'string' || !filter.stores.includes(store)) return false
    }
    if (filter.conditionGroups !== undefined && filter.conditionGroups.length > 0) {
      const group = row.condition_group
      if (typeof group !== 'string' || !filter.conditionGroups.includes(group))
        return false
    }
    if (filter.leadSources !== undefined && filter.leadSources.length > 0) {
      const source = row.lead_source_code
      if (typeof source !== 'string' || !filter.leadSources.includes(source)) return false
    }
    return true
  })
}

/** The distinct values of a text column, ascending. */
export function distinctValues(
  rows: readonly DashboardRow[],
  column: string
): readonly string[] {
  const values = new Set<string>()
  for (const row of rows) {
    const value = row[column]
    if (typeof value === 'string') values.add(value)
  }
  return [...values].sort()
}
