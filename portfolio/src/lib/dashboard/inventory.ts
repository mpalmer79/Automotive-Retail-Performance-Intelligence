/**
 * The inventory operations model: the unit population, its age profile and its price context.
 *
 * WHAT THIS MODULE OWNS
 * ---------------------
 * Selection and presentation shape. It owns no metric definition: `days_in_stock`,
 * `age_bucket`, `aged_threshold_days`, `price_to_market_ratio` and every money column are
 * read from the `inventory-units` dataset exactly as the governed export produced them. The
 * only arithmetic here is counting rows and summing already-exact investment figures. The
 * reporting view behind that dataset is named in the export contract, not here: this module
 * reads a committed file and has no way to query anything.
 *
 * THE THRESHOLD IS 60 DAYS AND IT COMES FROM THE DATA
 * ---------------------------------------------------
 * `aged_threshold_days` is published on every row precisely so a console states the threshold
 * it applied instead of hardcoding one, and `agedThresholdDays()` reads it back rather than
 * declaring it. It is the ARPI PROJECT DEFAULT from ARCHITECTURE.md section 18.2 — not an
 * industry benchmark, not an OEM target.
 *
 * IT IS A DIFFERENT NUMBER FROM THE TOP AGE BUCKET, and conflating the two is the specific
 * mistake this comment exists to prevent. The buckets are `0-30 | 31-60 | 61-90 | 91-120 |
 * Over 120`; the aged threshold is 60. A unit at 75 days is aged AND sits in `61-90`. Reading
 * "120" as the threshold would report a fraction of the aged stock the group actually holds.
 *
 * THE MARKET ESTIMATE IS SYNTHETIC AND THE RATIO IS DESCRIPTIVE
 * -------------------------------------------------------------
 * `market_price_estimate` is generated. No auction result, guidebook, licensed benchmark or
 * observed transaction exists anywhere in this project, and every surface rendering it or the
 * ratio derived from it has to say so — `SYNTHETIC_ESTIMATE_NOTE` is the sentence they use.
 * A ratio above 1.0 means the unit is advertised above its synthetic estimate. It is not
 * evidence the unit is overpriced, and nothing here or downstream may turn it into a
 * repricing recommendation: DASH.9 is descriptive.
 *
 * NULL IS NOT ZERO, ANYWHERE IN THIS FILE
 * ---------------------------------------
 * A unit with no estimate has no ratio; a unit on its first reportable snapshot has no prior
 * price and therefore no movement. Both are null and both stay null. Substituting zero would
 * assert "the estimate is nothing" and "the price did not change", which are different and
 * unsupported claims.
 *
 * SEMI-ADDITIVE. `inventory_investment` and the unit count are additive across vehicles and
 * stores on ONE snapshot date and never across dates. Every selector below works from a
 * single resolved snapshot date for that reason.
 */
import type { DashboardRow } from '@/types/dashboard'

import {
  addExact,
  cellToExact,
  compareExact,
  exactToApproxNumber,
  exactZero,
  subtractExact,
  type Exact,
} from './decimal'
import type { DashboardFilters } from './filters'

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/** The governed age buckets, in display order. The export enumerates exactly these five. */
export const AGE_BUCKETS = ['0-30', '31-60', '61-90', '91-120', 'Over 120'] as const

export type AgeBucket = (typeof AGE_BUCKETS)[number]

/** The disclosure every surface showing the estimate or the ratio carries. */
export const SYNTHETIC_ESTIMATE_NOTE =
  'The market price estimate is a synthetic reference value generated for this fictional ' +
  'dataset. It is not a market valuation and is drawn from no auction result, guidebook or ' +
  'licensed benchmark. Price to market compares the asking price against it and describes ' +
  'the difference; it is not evidence that a price is right or wrong.'

/** The disclosure the aged figures carry. */
export const AGED_THRESHOLD_NOTE =
  'The aged threshold is an ARPI project default, not an industry benchmark. It is a ' +
  'different number from the top age bucket: a unit past the threshold may sit in any ' +
  'bucket above it.'

/* -------------------------------------------------------------------------- */
/* Row shape                                                                   */
/* -------------------------------------------------------------------------- */

/** One vehicle at one store on one reportable snapshot date. */
export interface UnitRow {
  readonly dealershipId: string
  readonly snapshotDate: string
  readonly vehicleId: string
  readonly conditionType: string
  readonly conditionGroup: string
  readonly modelYear: number
  readonly make: string
  readonly modelName: string
  readonly trimLevel: string
  readonly bodyStyle: string
  readonly odometerReading: number
  readonly daysInStock: number
  readonly ageBucket: AgeBucket
  /** Read from the row, never declared here. */
  readonly agedThresholdDays: number
  readonly isAged: boolean
  readonly currentAskingPrice: Exact
  readonly originalAskingPrice: Exact
  readonly inventoryInvestment: Exact
  /** Null where the estimator declined to price the unit. Never zero-substituted. */
  readonly marketPriceEstimate: Exact | null
  /** Null wherever the estimate is. Never zero-substituted, never imputed. */
  readonly priceToMarketRatio: Exact | null
  readonly markdownCount: number
  /** Null on a unit's first reportable snapshot: no prior observation exists. */
  readonly priorAskingPrice: Exact | null
  /** Negative is a reduction. Null on a first snapshot. */
  readonly askingPriceChange: Exact | null
  readonly isPriceReducedSincePrior: boolean | null
}

function asString(value: unknown, column: string): string {
  if (typeof value !== 'string')
    throw new Error(`inventory-units.${column} is not a string`)
  return value
}

function asNumber(value: unknown, column: string): number {
  if (typeof value !== 'number')
    throw new Error(`inventory-units.${column} is not a number`)
  return value
}

function asExact(value: unknown, column: string): Exact {
  const exact = cellToExact((value ?? null) as string | number | boolean | null)
  if (exact === null) throw new Error(`inventory-units.${column} is unexpectedly null`)
  return exact
}

function asAgeBucket(value: unknown): AgeBucket {
  const found = AGE_BUCKETS.find((bucket) => bucket === value)
  if (found === undefined) {
    throw new Error(
      `unknown age bucket ${String(value)}; the export declares a closed set of five`
    )
  }
  return found
}

/** Decode exported rows into the shape the page renders. */
export function toUnitRows(rows: readonly DashboardRow[]): readonly UnitRow[] {
  return rows.map((row) => ({
    dealershipId: asString(row.dealership_id, 'dealership_id'),
    snapshotDate: asString(row.snapshot_date, 'snapshot_date'),
    vehicleId: asString(row.vehicle_id, 'vehicle_id'),
    conditionType: asString(row.condition_type, 'condition_type'),
    conditionGroup: asString(row.condition_group, 'condition_group'),
    modelYear: asNumber(row.model_year, 'model_year'),
    make: asString(row.make, 'make'),
    modelName: asString(row.model_name, 'model_name'),
    trimLevel: asString(row.trim_level, 'trim_level'),
    bodyStyle: asString(row.body_style, 'body_style'),
    odometerReading: asNumber(row.odometer_reading, 'odometer_reading'),
    daysInStock: asNumber(row.days_in_stock, 'days_in_stock'),
    ageBucket: asAgeBucket(row.age_bucket),
    agedThresholdDays: asNumber(row.aged_threshold_days, 'aged_threshold_days'),
    isAged: row.is_aged_over_default_threshold === true,
    currentAskingPrice: asExact(row.current_asking_price, 'current_asking_price'),
    originalAskingPrice: asExact(row.original_asking_price, 'original_asking_price'),
    inventoryInvestment: asExact(row.inventory_investment, 'inventory_investment'),
    marketPriceEstimate: cellToExact(row.market_price_estimate ?? null),
    priceToMarketRatio: cellToExact(row.price_to_market_ratio ?? null),
    markdownCount: asNumber(row.markdown_count_to_date, 'markdown_count_to_date'),
    priorAskingPrice: cellToExact(row.prior_asking_price ?? null),
    askingPriceChange: cellToExact(row.asking_price_change ?? null),
    isPriceReducedSincePrior:
      row.is_price_reduced_since_prior === null
        ? null
        : row.is_price_reduced_since_prior === true,
  }))
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

/** The snapshot dates the export carries, newest first. */
export function snapshotDates(rows: readonly UnitRow[]): readonly string[] {
  return [...new Set(rows.map((row) => row.snapshotDate))].sort().reverse()
}

/**
 * The snapshot date a period resolves to, or null when it covers none.
 *
 * THE LAST DATE IN THE PERIOD, NOT A SUM OVER IT — the same semi-additive rule the accounting
 * model follows, for the same reason. `dates` is newest-first, so the first match inside a
 * period is the last snapshot within it.
 */
export function resolveSnapshotDate(
  rows: readonly UnitRow[],
  filters: DashboardFilters
): string | null {
  const dates = snapshotDates(rows)
  if (dates.length === 0) return null
  const period = filters.period
  switch (period.kind) {
    case 'default':
      return dates[0] ?? null
    case 'month':
      return dates.find((date) => date.startsWith(period.month)) ?? null
    case 'range':
      return dates.find((date) => date >= period.start && date <= period.end) ?? null
    case 'mtd':
    case 'last-30d':
      return dates[0] ?? null
  }
}

/** How a unit search term is matched, published so the page can say what it searches. */
export const SEARCHABLE_FIELDS = 'vehicle identifier, make, model and trim'

/**
 * The unit population for one snapshot date, narrowed by the supported filters.
 *
 * `condition` narrows on condition_TYPE. The row also carries `condition_group`, the SALES
 * rule in which Certified collapses into Used, and the two are deliberately not
 * interchangeable: the accounting domain separates Certified into its own control account
 * while the sales domain groups it with Used. Two domains, two correct groupings, and a page
 * that silently swapped them would show a population its own KPIs do not describe.
 */
export function selectUnits(
  rows: readonly UnitRow[],
  snapshotDate: string | null,
  filters: DashboardFilters,
  search: string | null
): readonly UnitRow[] {
  if (snapshotDate === null) return []
  const stores = new Set(filters.store)
  const term = search === null ? null : search.trim().toLowerCase()
  return rows.filter((row) => {
    if (row.snapshotDate !== snapshotDate) return false
    if (stores.size > 0 && !stores.has(row.dealershipId)) return false
    if (filters.make !== null && row.make.toLowerCase() !== filters.make.toLowerCase()) {
      return false
    }
    if (
      filters.model !== null &&
      row.modelName.toLowerCase() !== filters.model.toLowerCase()
    ) {
      return false
    }
    // `condition` narrows on condition_TYPE, not condition_group, because the governed
    // filter vocabulary is the three types. `condition=Certified` therefore shows certified
    // units alone rather than the whole Used group that contains them, which is the only
    // reading under which the parameter's third value means anything at all.
    if (filters.condition !== null && row.conditionType !== filters.condition)
      return false
    if (term !== null && term.length > 0) {
      const haystack =
        `${row.vehicleId} ${row.make} ${row.modelName} ${row.trimLevel}`.toLowerCase()
      if (!haystack.includes(term)) return false
    }
    return true
  })
}

/** One unit by its business identifier, or null when the selection holds none. */
export function findUnit(
  rows: readonly UnitRow[],
  vehicleId: string | null
): UnitRow | null {
  if (vehicleId === null) return null
  return rows.find((row) => row.vehicleId === vehicleId) ?? null
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

/** The age profile of one bucket. */
export interface BucketProfile {
  readonly bucket: AgeBucket
  readonly units: number
  readonly investment: Exact
  /** Units in this bucket as a share of the population, to four places. Null when empty. */
  readonly share: number | null
  /**
   * This bucket's share of the population's total INVESTMENT. Null on a zero total.
   *
   * Published so the age visual can draw units and capital over the same five bands. The
   * finding a used-vehicle manager is looking for — eleven per cent of the units and
   * twenty-six per cent of the money — is invisible unless the two distributions are read
   * against each other, and it cannot be recovered from the unit share alone.
   */
  readonly investmentShare: number | null
  /**
   * Asking price at this snapshot, summed over the bucket, beside the original.
   *
   * TWO EXPORTED COLUMNS SUMMED OVER THE SAME ROWS. `markdown` is the difference between
   * them and is therefore the reduction taken SINCE LISTING — not since the prior month
   * end, which is a different figure the unit rows publish separately and which this
   * module counts rather than sums. Conflating the two would report a month's repricing as
   * a lifetime's.
   */
  readonly originalAsking: Exact
  readonly currentAsking: Exact
  readonly markdown: Exact
  /** Units whose advertised price fell between the prior month end and this one. */
  readonly reducedSincePrior: number
}

/** The inventory position for one snapshot date and filter selection. */
export interface InventorySummary {
  readonly snapshotDate: string | null
  readonly units: number
  readonly investment: Exact
  /** The order statistic. Computed from the population, never averaged from subgroups. */
  readonly medianAge: number | null
  /** Supporting context only; the median is the headline. */
  readonly meanAge: number | null
  readonly agedUnits: number
  readonly agedShare: number | null
  /** Read from the data. 60 in this repository, and a project default. */
  readonly agedThresholdDays: number | null
  readonly buckets: readonly BucketProfile[]
  readonly unitsWithEstimate: number
  readonly unitsWithoutEstimate: number
  /**
   * The share of units the estimator priced, or null on an empty population.
   *
   * Named coverage rather than a rate: it describes how much of the lot the price-to-market
   * ratio can be read over, and a unit with no estimate has no ratio rather than a ratio of
   * zero.
   */
  readonly estimateCoverage: number | null
  readonly reducedSincePrior: number
  /** The whole population's advertised prices, for the price-movement visual. */
  readonly originalAsking: Exact
  readonly currentAsking: Exact
  readonly markdown: Exact
}

/**
 * The median days in stock of a population.
 *
 * COMPUTED FROM THE UNITS THEMSELVES. A median cannot be recovered from group medians, and
 * averaging per-store or per-bucket medians would produce a number that describes no unit on
 * any lot. This takes the whole selected population every time.
 */
export function medianDaysInStock(rows: readonly UnitRow[]): number | null {
  if (rows.length === 0) return null
  const ages = rows.map((row) => row.daysInStock).sort((a, b) => a - b)
  const middle = Math.floor(ages.length / 2)
  if (ages.length % 2 === 1) return ages[middle] ?? null
  const lower = ages[middle - 1]
  const upper = ages[middle]
  if (lower === undefined || upper === undefined) return null
  return (lower + upper) / 2
}

/** Summarize one snapshot date's selected population. */
export function summarizeInventory(
  rows: readonly UnitRow[],
  snapshotDate: string | null
): InventorySummary {
  let investment = exactZero(2)
  let agedUnits = 0
  let ageTotal = 0
  let unitsWithEstimate = 0
  let reducedSincePrior = 0

  for (const row of rows) {
    investment = addExact(investment, row.inventoryInvestment)
    if (row.isAged) agedUnits += 1
    ageTotal += row.daysInStock
    if (row.marketPriceEstimate !== null) unitsWithEstimate += 1
    if (row.isPriceReducedSincePrior === true) reducedSincePrior += 1
  }

  const units = rows.length
  const investmentTotal = exactToApproxNumber(investment)

  let originalAskingTotal = exactZero(2)
  let currentAskingTotal = exactZero(2)
  for (const row of rows) {
    originalAskingTotal = addExact(originalAskingTotal, row.originalAskingPrice)
    currentAskingTotal = addExact(currentAskingTotal, row.currentAskingPrice)
  }

  const buckets = AGE_BUCKETS.map((bucket) => {
    const inBucket = rows.filter((row) => row.ageBucket === bucket)
    let bucketInvestment = exactZero(2)
    let bucketOriginal = exactZero(2)
    let bucketCurrent = exactZero(2)
    let bucketReduced = 0
    for (const row of inBucket) {
      bucketInvestment = addExact(bucketInvestment, row.inventoryInvestment)
      bucketOriginal = addExact(bucketOriginal, row.originalAskingPrice)
      bucketCurrent = addExact(bucketCurrent, row.currentAskingPrice)
      if (row.isPriceReducedSincePrior === true) bucketReduced += 1
    }
    return {
      bucket,
      units: inBucket.length,
      investment: bucketInvestment,
      share: units === 0 ? null : inBucket.length / units,
      /*
       * The share is taken against the population's own investment total, not against the
       * largest bucket: a distribution divided by its own mode is not a distribution. The
       * float is a SHARE for a bar width and never a displayed amount — every figure the
       * visual prints comes from `investment`, which stays exact.
       */
      investmentShare:
        investmentTotal === 0
          ? null
          : exactToApproxNumber(bucketInvestment) / investmentTotal,
      originalAsking: bucketOriginal,
      currentAsking: bucketCurrent,
      markdown: subtractExact(bucketOriginal, bucketCurrent),
      reducedSincePrior: bucketReduced,
    }
  })

  return {
    snapshotDate,
    units,
    investment,
    medianAge: medianDaysInStock(rows),
    meanAge: units === 0 ? null : ageTotal / units,
    agedUnits,
    agedShare: units === 0 ? null : agedUnits / units,
    agedThresholdDays: rows[0]?.agedThresholdDays ?? null,
    buckets,
    unitsWithEstimate,
    unitsWithoutEstimate: units - unitsWithEstimate,
    estimateCoverage: units === 0 ? null : unitsWithEstimate / units,
    reducedSincePrior,
    originalAsking: originalAskingTotal,
    currentAsking: currentAskingTotal,
    markdown: subtractExact(originalAskingTotal, currentAskingTotal),
  }
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

/** The sorts the unit table offers. */
export const UNIT_SORTS = [
  'age-desc',
  'age-asc',
  'price-desc',
  'price-asc',
  'ratio-desc',
  'ratio-asc',
  'store',
] as const

export type UnitSort = (typeof UNIT_SORTS)[number]

/** The neutral default: store, then unit. It states no opinion about which units are bad. */
export const DEFAULT_UNIT_SORT: UnitSort = 'store'

export function parseUnitSort(value: string | null): UnitSort {
  const found = UNIT_SORTS.find((sort) => sort === value)
  return found ?? DEFAULT_UNIT_SORT
}

/**
 * Sort the unit table.
 *
 * EVERY COMPARATOR IS TOTAL AND STABLE. Each falls back to `vehicleId`, which is unique
 * within a snapshot date, so no two rows ever compare equal and the order cannot depend on
 * the input order. Money and ratios compare through the exact-decimal comparator; nothing
 * here calls `Number()` on a monetary string.
 *
 * A NULL RATIO SORTS LAST IN BOTH DIRECTIONS. "No estimate" is not a high ratio or a low one,
 * so it is never allowed to occupy either end of a ranking.
 */
export function sortUnits(rows: readonly UnitRow[], sort: UnitSort): readonly UnitRow[] {
  const byId = (a: UnitRow, b: UnitRow): number => a.vehicleId.localeCompare(b.vehicleId)
  const ratio = (a: UnitRow, b: UnitRow, direction: 1 | -1): number => {
    if (a.priceToMarketRatio === null && b.priceToMarketRatio === null) return byId(a, b)
    if (a.priceToMarketRatio === null) return 1
    if (b.priceToMarketRatio === null) return -1
    const compared = compareExact(a.priceToMarketRatio, b.priceToMarketRatio) * direction
    return compared !== 0 ? compared : byId(a, b)
  }

  const comparators: Readonly<Record<UnitSort, (a: UnitRow, b: UnitRow) => number>> = {
    'age-desc': (a, b) => b.daysInStock - a.daysInStock || byId(a, b),
    'age-asc': (a, b) => a.daysInStock - b.daysInStock || byId(a, b),
    'price-desc': (a, b) =>
      compareExact(b.currentAskingPrice, a.currentAskingPrice) || byId(a, b),
    'price-asc': (a, b) =>
      compareExact(a.currentAskingPrice, b.currentAskingPrice) || byId(a, b),
    'ratio-desc': (a, b) => ratio(a, b, -1),
    'ratio-asc': (a, b) => ratio(a, b, 1),
    store: (a, b) => a.dealershipId.localeCompare(b.dealershipId) || byId(a, b),
  }

  return [...rows].sort(comparators[sort])
}
