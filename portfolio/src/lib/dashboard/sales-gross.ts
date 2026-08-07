/**
 * The Sales and Gross page's view model.
 *
 * WHAT THIS MODULE MAY DO
 * -----------------------
 * Sum exported additive columns, count exported rows into bands, divide one summed
 * column by another, and format the result. Every one of those is a selection or an
 * arithmetic identity the reporting layer already owns.
 *
 * WHAT IT MAY NOT DO, AND STRUCTURALLY CANNOT
 * -------------------------------------------
 * Invent a measure. Every figure here traces to a column of `sales-gross-trend`,
 * `gross-change-bridge` or `deal-explorer`, and the three datasets were built by
 * views whose arithmetic is asserted against the fact on every integration run.
 *
 * TWO RULES THAT ARE EASY TO BREAK AND ARE NOT BROKEN HERE
 * --------------------------------------------------------
 * 1. A rate is never re-aggregated. `sales-gross-trend` publishes a per-unit gross
 *    column, and it is valid at store-day grain ONLY. Every rate on this page is
 *    recomputed as SUM(numerator) / SUM(denominator) from the additive columns. A
 *    weekly PVR is never the average of seven daily PVRs, because that is a
 *    different and wrong number: it weights a Tuesday that sold one unit the same as
 *    a Saturday that sold nine.
 * 2. A zero denominator yields a stated absence, never a zero. `divideExact` returns
 *    null and the metric renders "No eligible denominator".
 *
 * THE BRIDGE IS READ, NOT COMPUTED
 * --------------------------------
 * `vw_gross_change_bridge` owns the decomposition and its order. This module reads
 * the exported numerators, VERIFIES the identity that SQL guarantees, and divides
 * each numerator by the shared denominator for display. It never decides how much of
 * a change belongs to volume. The distinction matters: verification is allowed by
 * ADR-0013, allocation is not.
 */
import type { KpiEntry } from '@/types/content'
import type { DashboardRow } from '@/types/dashboard'
import { kpis } from '@/lib/content'

import type { Exact } from './decimal'
import {
  addExact,
  cellToExact,
  compareExact,
  divideExact,
  exactFromInteger,
  exactToString,
  exactZero,
  isNegative,
  isZero,
  multiplyByInteger,
  parseExact,
  subtractExact,
  sumExact,
} from './decimal'
import type { DashboardFilters } from './filters'
import { activeFilterChips, SALES_GROSS_SUPPORT, type ActiveFilterChip } from './filters'
import {
  dashboardCalendar,
  dashboardManifest,
  dashboardStores,
  dashboardStoreIds,
  numericCell,
  textCell,
  type DashboardStore,
} from './data'
import { dealChunkFile } from './deal-chunks'
import {
  formatCountExact,
  formatCurrencyDifference,
  formatCurrencyExact,
  formatIsoDate,
  formatIsoMonth,
  formatPerUnitDifference,
  formatPerUnitExact,
  formatRatioAsPercent,
} from './format'
import {
  calendarWindow,
  resolvePeriod,
  type PeriodContext,
  type ResolvedPeriod,
} from './periods'
import { grossChangeBridgeRows, salesGrossTrendRows } from './sales-gross-data'
import { buildTargetContext, type TargetContext } from './targets'

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                               */
/* -------------------------------------------------------------------------- */

/** A resolved figure, or a stated reason it has none. */
export type Figure =
  | { readonly kind: 'value'; readonly value: Exact; readonly display: string }
  | { readonly kind: 'no-rows' }
  | { readonly kind: 'null-ratio' }
  | { readonly kind: 'not-applicable'; readonly reason: string }

/** A figure beside its comparison. */
export interface ComparedFigure {
  readonly current: Figure
  readonly comparison: Figure
  /** Signed difference, already formatted, or null when either side has no value. */
  readonly difference: string | null
}

export interface PerformanceMetric {
  readonly id: string
  readonly label: string
  readonly kpiId: string | null
  readonly unit: string
  readonly figure: ComparedFigure
}

/* -------------------------------------------------------------------------- */
/* Row aggregation over the trend dataset                                      */
/* -------------------------------------------------------------------------- */

/**
 * Sum one additive column over a set of rows.
 *
 * Returns `null` when there are no rows at all, which is a different fact from a sum
 * of zero: "no transaction was finalized" is not "transactions totalling nothing".
 */
function sumColumn(rows: readonly DashboardRow[], column: string): Exact | null {
  if (rows.length === 0) return null
  const values: Exact[] = []
  for (const row of rows) {
    const exact = cellToExact(numericCell(row, column))
    if (exact !== null) values.push(exact)
  }
  if (values.length === 0) return null
  return sumExact(values)
}

/** A summed column as a figure, formatted by its kind. */
function currencyFigure(rows: readonly DashboardRow[], column: string): Figure {
  const total = sumColumn(rows, column)
  if (total === null) return { kind: 'no-rows' }
  return { kind: 'value', value: total, display: formatCurrencyExact(total) }
}

function countFigure(rows: readonly DashboardRow[], column: string): Figure {
  const total = sumColumn(rows, column)
  if (total === null) return { kind: 'no-rows' }
  return { kind: 'value', value: total, display: formatCountExact(total) }
}

/**
 * A rate, recomputed from its own numerator and denominator at whatever grain the
 * caller assembled. Never an average of the dataset's per-row rate column.
 */
function rateFigure(
  rows: readonly DashboardRow[],
  numeratorColumn: string,
  denominatorColumn: string
): Figure {
  const numerator = sumColumn(rows, numeratorColumn)
  const denominator = sumColumn(rows, denominatorColumn)
  if (numerator === null || denominator === null) return { kind: 'no-rows' }
  const quotient = divideExact(numerator, denominator, 6)
  if (quotient === null) return { kind: 'null-ratio' }
  return { kind: 'value', value: quotient, display: formatPerUnitExact(quotient) }
}

/** The difference between two figures, formatted, or null when either is absent. */
function difference(
  current: Figure,
  comparison: Figure,
  format: (value: Exact) => string
): string | null {
  if (current.kind !== 'value' || comparison.kind !== 'value') return null
  return format(subtractExact(current.value, comparison.value))
}

/* -------------------------------------------------------------------------- */
/* Trend series                                                                */
/* -------------------------------------------------------------------------- */

export type TrendGranularity = 'daily' | 'weekly' | 'monthly'

export interface TrendSeriesPoint {
  readonly key: string
  readonly label: string
  readonly retailUnits: Exact
  readonly frontGross: Exact
  readonly backGross: Exact
  readonly totalGross: Exact
  /** Null when the bucket sold no retail unit: a rate with no denominator. */
  readonly totalPvr: Exact | null
}

export interface TrendSeries {
  readonly granularity: TrendGranularity
  readonly points: readonly TrendSeriesPoint[]
  /** Stated when a granularity was requested and is not meaningful for the range. */
  readonly notice: string | null
}

/** The ISO week-start (Monday) of a date, computed from parts, never from `Date` parsing. */
function weekStart(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return iso
  // Zeller-free: build a UTC date from explicit parts. `new Date(y, m, d)` with
  // numeric arguments is not the string-parsing path the house rule forbids.
  const date = new Date(Date.UTC(year, month - 1, day))
  const weekday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - weekday)
  return date.toISOString().slice(0, 10)
}

function bucketOf(iso: string, granularity: TrendGranularity): string {
  if (granularity === 'daily') return iso
  if (granularity === 'monthly') return `${iso.slice(0, 7)}-01`
  return weekStart(iso)
}

function bucketLabel(key: string, granularity: TrendGranularity): string {
  if (granularity === 'monthly') return formatIsoMonth(key.slice(0, 7))
  if (granularity === 'weekly') return `Week of ${formatIsoDate(key)}`
  return formatIsoDate(key)
}

/**
 * Group store-day rows into buckets and RE-AGGREGATE every measure.
 *
 * The per-unit rate is computed once per bucket from that bucket's own summed
 * numerator and denominator. It is never the mean of the rows' rate column.
 */
function buildSeries(
  rows: readonly DashboardRow[],
  granularity: TrendGranularity
): readonly TrendSeriesPoint[] {
  const buckets = new Map<string, DashboardRow[]>()
  for (const row of rows) {
    const key = bucketOf(textCell(row, 'sale_date'), granularity)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
    else buckets.set(key, [row])
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucketRows]) => {
      const retailUnits = sumColumn(bucketRows, 'retail_units_sold') ?? exactZero(0)
      const frontGross = sumColumn(bucketRows, 'front_end_gross') ?? exactZero(2)
      const backGross = sumColumn(bucketRows, 'back_end_gross') ?? exactZero(2)
      const totalGross = sumColumn(bucketRows, 'total_gross') ?? exactZero(2)
      return {
        key,
        label: bucketLabel(key, granularity),
        retailUnits,
        frontGross,
        backGross,
        totalGross,
        totalPvr: divideExact(totalGross, retailUnits, 2),
      }
    })
}

/* -------------------------------------------------------------------------- */
/* Mix                                                                         */
/* -------------------------------------------------------------------------- */

export interface MixRow {
  readonly key: string
  readonly label: string
  readonly units: number
  readonly gross: Exact
  readonly grossDisplay: string
  /** Share of the mix total, or null when the total is zero. */
  readonly share: string | null
}

export interface MixBreakdown {
  readonly id: string
  readonly title: string
  readonly rows: readonly MixRow[]
  readonly note: string | null
}

function shareOf(part: Exact, whole: Exact): string | null {
  const ratio = divideExact(part, whole, 6)
  if (ratio === null) return null
  return formatRatioAsPercent(ratio)
}

/* -------------------------------------------------------------------------- */
/* Gross distribution, from deal-grain rows                                    */
/* -------------------------------------------------------------------------- */

export interface DistributionBand {
  readonly key: string
  readonly label: string
  readonly count: number
  readonly isNegative: boolean
}

export interface GrossDistribution {
  readonly bands: readonly DistributionBand[]
  readonly dealCount: number
  /** Median deal gross, computed from deal-grain values. Null on an empty set. */
  readonly median: Exact | null
  readonly medianDisplay: string | null
  /** Mean deal gross. Equals KPI-GRS-006 over the same population. */
  readonly mean: Exact | null
  readonly meanDisplay: string | null
  readonly negativeFrontCount: number
}

/** The governed bands. Chosen once, here, so every distribution uses the same ones. */
const GROSS_BANDS: readonly {
  key: string
  label: string
  min: number | null
  max: number | null
}[] = [
  { key: 'loss', label: 'Below $0', min: null, max: 0 },
  { key: 'b0', label: '$0 to $999', min: 0, max: 1000 },
  { key: 'b1', label: '$1,000 to $1,999', min: 1000, max: 2000 },
  { key: 'b2', label: '$2,000 to $2,999', min: 2000, max: 3000 },
  { key: 'b3', label: '$3,000 to $4,999', min: 3000, max: 5000 },
  { key: 'b4', label: '$5,000 to $7,499', min: 5000, max: 7500 },
  { key: 'b5', label: '$7,500 and above', min: 7500, max: null },
]

/**
 * Count deal-grain rows into bands, and take the median from the values themselves.
 *
 * THE MEDIAN IS COMPUTED FROM DEAL-GRAIN VALUES, NEVER FROM THE BANDS and never from
 * store medians. An order statistic cannot be recomputed from an aggregate, which is
 * exactly why the reporting layer exposes row-level values wherever a median is
 * specified. Sorting exact decimals and taking the middle is the sanctioned method.
 *
 * THE MEAN IS THE GOVERNED RATIO. Over a retail population, sum(total_gross) /
 * count(deals) is KPI-GRS-006 by definition, so it is the same number the
 * performance summary shows -- computed here from the same exported column, not from
 * a second definition.
 */
function buildDistribution(
  deals: readonly DashboardRow[],
  column: string
): GrossDistribution {
  const values: Exact[] = []
  let negativeFrontCount = 0
  for (const deal of deals) {
    const exact = cellToExact(numericCell(deal, column))
    if (exact !== null) values.push(exact)
    if (numericCell(deal, 'front_end_gross') !== null) {
      const front = cellToExact(numericCell(deal, 'front_end_gross'))
      if (front !== null && isNegative(front)) negativeFrontCount += 1
    }
  }

  const bands = GROSS_BANDS.map((band) => {
    const min = band.min === null ? null : parseExact(`${String(band.min)}.00`)
    const max = band.max === null ? null : parseExact(`${String(band.max)}.00`)
    const count = values.filter((value) => {
      if (min !== null && compareExact(value, min) < 0) return false
      if (max !== null && compareExact(value, max) >= 0) return false
      return true
    }).length
    return { key: band.key, label: band.label, count, isNegative: band.key === 'loss' }
  })

  const sorted = [...values].sort(compareExact)
  let median: Exact | null = null
  if (sorted.length > 0) {
    const middle = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 1) {
      median = sorted[middle] ?? null
    } else {
      const lower = sorted[middle - 1]
      const upper = sorted[middle]
      median =
        lower !== undefined && upper !== undefined
          ? divideExact(addExact(lower, upper), exactFromInteger(2), 2)
          : null
    }
  }

  const total = sorted.length === 0 ? null : sumExact(sorted)
  const mean =
    total === null ? null : divideExact(total, exactFromInteger(sorted.length), 2)

  return {
    bands,
    dealCount: values.length,
    median,
    medianDisplay: median === null ? null : formatCurrencyExact(median, 0),
    mean,
    meanDisplay: mean === null ? null : formatCurrencyExact(mean, 0),
    negativeFrontCount,
  }
}

/* -------------------------------------------------------------------------- */
/* The bridge                                                                  */
/* -------------------------------------------------------------------------- */

export interface BridgeComponent {
  readonly code: string
  readonly label: string
  readonly amount: Exact
  readonly display: string
}

export type BridgeState =
  | {
      readonly kind: 'available'
      readonly monthLabel: string
      readonly comparisonLabel: string
      readonly comparisonTotal: Exact
      readonly currentTotal: Exact
      readonly change: Exact
      readonly components: readonly BridgeComponent[]
      /** Non-zero only when rounding the components to the cent leaves a residual. */
      readonly rounding: Exact | null
      /** True when the exported numerators reconcile exactly. */
      readonly verified: boolean
      /** The sentence a reader sees. Attribution wording, never causal. */
      readonly statement: string
    }
  | {
      readonly kind: 'unavailable'
      readonly reason: string
      readonly monthLabel: string | null
      /** The period change is defined even when its decomposition is not. */
      readonly change: Exact | null
      readonly changeDisplay: string | null
    }

const NOT_COMPARABLE_COPY: Readonly<Record<string, string>> = {
  'comparison-period-outside-window':
    'The month before this one is outside the reporting window, so there is no baseline to compare against.',
  'comparison-period-no-retail-units':
    'The comparison month sold no retail units, so there is no baseline per-unit gross to price the volume change at.',
}

/**
 * Read the exported bridge for one store scope and month, and verify it.
 *
 * VERIFICATION, NOT ALLOCATION. The identity checked is the one SQL guarantees:
 * the three numerators sum to denominator x change, exactly, with no division on
 * either side. If it fails the page says so rather than rendering a decomposition it
 * could not confirm.
 *
 * WHY A ROUNDING LINE. Each displayed component is numerator / denominator rounded
 * to the cent, and three rounded values need not sum to the rounded change. The
 * residual is at most a cent or two and it is shown rather than absorbed into a
 * component, because silently adjusting one component would misstate it.
 *
 * GROUP SCOPE SUMS NUMERATORS, NOT AMOUNTS. Across stores the denominators differ,
 * so the amounts are added after each store's own division -- which is the only
 * correct order, and is why the group residual can reach a few cents.
 */
function buildBridge(
  rows: readonly DashboardRow[],
  stores: readonly string[],
  month: string | null
): BridgeState {
  if (month === null) {
    return {
      kind: 'unavailable',
      reason:
        'The bridge compares one calendar month with the month before it. Select a period that covers a single whole month to see it.',
      monthLabel: null,
      change: null,
      changeDisplay: null,
    }
  }

  const monthStart = `${month}-01`
  const scoped = rows.filter(
    (row) =>
      textCell(row, 'month_start_date') === monthStart &&
      stores.includes(textCell(row, 'dealership_id'))
  )
  const monthLabel = formatIsoMonth(month)

  if (scoped.length === 0) {
    return {
      kind: 'unavailable',
      reason: 'The export carries no bridge row for this month and store scope.',
      monthLabel,
      change: null,
      changeDisplay: null,
    }
  }

  // The period change is defined for every row, comparable or not.
  const perStore = new Map<string, DashboardRow[]>()
  for (const row of scoped) {
    const store = textCell(row, 'dealership_id')
    const bucket = perStore.get(store)
    if (bucket) bucket.push(row)
    else perStore.set(store, [row])
  }

  const changes: Exact[] = []
  const comparisonTotals: Exact[] = []
  const currentTotals: Exact[] = []
  const notComparable: string[] = []
  const amounts = new Map<string, Exact>()
  const labels = new Map<string, string>()
  let verified = true

  for (const [, storeRows] of perStore) {
    const first = storeRows[0]
    if (first === undefined) continue
    const change = cellToExact(numericCell(first, 'total_gross_change'))
    const comparisonTotal = cellToExact(numericCell(first, 'comparison_total_gross'))
    const currentTotal = cellToExact(numericCell(first, 'total_gross'))
    if (change !== null) changes.push(change)
    if (comparisonTotal !== null) comparisonTotals.push(comparisonTotal)
    if (currentTotal !== null) currentTotals.push(currentTotal)

    const comparable = first.is_comparable === true
    if (!comparable) {
      const reason = first.not_comparable_reason
      if (typeof reason === 'string') notComparable.push(reason)
      continue
    }

    // Verify the exported identity for this store, then divide for display.
    const denominator = cellToExact(numericCell(first, 'effect_denominator'))
    if (denominator === null || change === null) {
      verified = false
      continue
    }
    const numerators: Exact[] = []
    for (const row of storeRows) {
      const numerator = cellToExact(numericCell(row, 'effect_numerator'))
      if (numerator === null) {
        verified = false
        continue
      }
      numerators.push(numerator)
      const code = textCell(row, 'component_code')
      labels.set(code, textCell(row, 'component_label'))
      const amount = divideExact(numerator, denominator, 2)
      if (amount === null) {
        verified = false
        continue
      }
      const running = amounts.get(code)
      amounts.set(code, running === undefined ? amount : addExact(running, amount))
    }
    if (numerators.length === 3) {
      const expected = multiplyByInteger(change, BigInt(exactToString(denominator)))
      if (compareExact(sumExact(numerators), expected) !== 0) verified = false
    } else {
      verified = false
    }
  }

  if (amounts.size === 0) {
    const reason = notComparable[0]
    const change = changes.length > 0 ? sumExact(changes) : null
    return {
      kind: 'unavailable',
      reason:
        reason !== undefined && reason in NOT_COMPARABLE_COPY
          ? (NOT_COMPARABLE_COPY[reason] as string)
          : 'The comparison period cannot be used as a baseline for this scope.',
      monthLabel,
      change,
      changeDisplay: change === null ? null : formatCurrencyDifference(change),
    }
  }

  const change = sumExact(changes)
  const comparisonTotal = sumExact(comparisonTotals)
  const currentTotal = sumExact(currentTotals)

  const order = ['volume', 'front_pvr', 'back_pvr']
  const components: BridgeComponent[] = order
    .filter((code) => amounts.has(code))
    .map((code) => {
      const amount = amounts.get(code) as Exact
      return {
        code,
        label: labels.get(code) ?? code,
        amount,
        display: formatCurrencyDifference(amount),
      }
    })

  const summed = sumExact(components.map((component) => component.amount))
  const residual = subtractExact(change, summed)
  const rounding = isZero(residual) ? null : residual

  const statement = buildBridgeStatement(change, components, monthLabel)

  return {
    kind: 'available',
    monthLabel,
    comparisonLabel: 'the month before',
    comparisonTotal,
    currentTotal,
    change,
    components,
    rounding,
    verified,
    statement,
  }
}

/**
 * The sentence the page prints beneath the bridge.
 *
 * ATTRIBUTION WORDING ONLY. "The bridge attributes" and "the decomposition assigns"
 * are the approved forms. Nothing here says a person, a department, an inventory
 * position or a marketing spend caused any part of the change, because the method
 * that would support such a claim does not exist in this project.
 */
/** How each component is named in the sentence. Nouns, not causes. */
const BRIDGE_PHRASE: Readonly<Record<string, string>> = {
  volume: 'unit volume',
  front_pvr: 'front PVR',
  back_pvr: 'back PVR',
}

function buildBridgeStatement(
  change: Exact,
  components: readonly BridgeComponent[],
  monthLabel: string
): string {
  const direction = isNegative(change)
    ? 'decreased'
    : isZero(change)
      ? 'was unchanged'
      : 'increased'
  const magnitude = formatCurrencyExact(absolute(change))
  const parts = components
    .map(
      (component) =>
        `${component.display} to ${BRIDGE_PHRASE[component.code] ?? component.label}`
    )
    .join(', ')
  const opening = isZero(change)
    ? `Total gross was unchanged against the month before.`
    : `In ${monthLabel}, total gross ${direction} by ${magnitude} against the month before.`
  return `${opening} The bridge attributes ${parts}.`
}

function absolute(value: Exact): Exact {
  return isNegative(value) ? subtractExact(exactZero(value.scale), value) : value
}

/* -------------------------------------------------------------------------- */
/* The view model                                                              */
/* -------------------------------------------------------------------------- */

export interface StoreScope {
  readonly ids: readonly string[]
  readonly stores: readonly DashboardStore[]
  readonly isGroup: boolean
  readonly label: string
}

export interface SalesGrossView {
  readonly scope: StoreScope
  readonly periodContext: PeriodContext
  readonly asOfDate: string
  readonly chips: readonly ActiveFilterChip[]
  readonly empty: boolean
  readonly performance: readonly PerformanceMetric[]
  readonly series: TrendSeries
  readonly mixes: readonly MixBreakdown[]
  readonly contribution: {
    readonly front: Figure
    readonly back: Figure
    readonly frontShare: string | null
    readonly backShare: string | null
  }
  readonly discounts: readonly PerformanceMetric[]
  readonly distribution: GrossDistribution
  readonly bridge: BridgeState
  readonly conditionFilterApplied: boolean
  /**
   * Targets, attainment and the selling-day clock for the selected scope.
   *
   * Built by the same module the Executive Overview uses, so the two routes cannot
   * disagree about a store's attainment. Deliberately NOT folded into the gross-change
   * bridge: the bridge decomposes a period-over-period change and a plan variance is a
   * different question, so a fourth "plan" effect there would change what the
   * decomposition means.
   */
  readonly targets: TargetContext
}

const reportingCalendar = calendarWindow(dashboardCalendar, dashboardManifest.asOfDate)

function resolveStoreScope(filters: DashboardFilters): StoreScope {
  const ids = filters.store.length === 0 ? dashboardStoreIds : filters.store
  const stores = dashboardStores.filter((store) => ids.includes(store.id))
  return {
    ids,
    stores,
    isGroup: filters.store.length === 0,
    label:
      filters.store.length === 0
        ? 'Granite Auto Group, all three stores'
        : stores.map((store) => store.shortName).join(', '),
  }
}

/** Which whole month the range is, or null when it is not exactly one. */
function singleWholeMonth(period: ResolvedPeriod): string | null {
  if (period.wholeMonths.length !== 1) return null
  const month = period.wholeMonths[0]
  return month === undefined ? null : month
}

/**
 * Pick the granularity that suits the range.
 *
 * A six-month range plotted daily is 184 columns of noise; one month plotted monthly
 * is a single column. The choice is made from the range and stated, rather than
 * offered as a control that would need client JavaScript to be useful.
 */
function chooseGranularity(period: ResolvedPeriod): TrendGranularity {
  if (period.calendarDays <= 45) return 'daily'
  if (period.calendarDays <= 130) return 'weekly'
  return 'monthly'
}

/** Rows of the trend dataset inside the period and store scope. */
function trendRowsFor(
  rows: readonly DashboardRow[],
  stores: readonly string[],
  period: ResolvedPeriod
): readonly DashboardRow[] {
  return rows.filter((row) => {
    const date = textCell(row, 'sale_date')
    if (date < period.start || date > period.end) return false
    return stores.includes(textCell(row, 'dealership_id'))
  })
}

/** Deal rows inside the period and store scope, read only from the needed partitions. */
function dealRowsFor(
  stores: readonly string[],
  period: ResolvedPeriod,
  filters: DashboardFilters
): readonly DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const store of stores) {
    for (const month of period.months) {
      const file = dealChunkFile(store, month)
      if (file === undefined) continue
      const columns = file.columns
      for (const values of file.rows) {
        const row: Record<string, unknown> = {}
        for (let index = 0; index < columns.length; index += 1) {
          const key = columns[index]
          if (key === undefined) continue
          row[key] = values[index] ?? null
        }
        const typed = row as DashboardRow
        const date = textCell(typed, 'sale_date')
        if (date < period.start || date > period.end) continue
        if (typed.is_retail !== true) continue
        if (filters.condition !== null) {
          // Condition TYPE matches the type column; the two group values match the
          // group column. One filter, two legitimate targets.
          const type = textCell(typed, 'condition_type')
          const group = textCell(typed, 'condition_group')
          if (filters.condition === 'Certified') {
            if (type !== 'Certified') continue
          } else if (group !== filters.condition) continue
        }
        rows.push(typed)
      }
    }
  }
  return rows
}

/**
 * Build the page.
 *
 * The condition filter is APPLIED here, unlike on the Executive Overview, because
 * `sales-gross-trend` publishes the condition split as additive columns. Selecting
 * "New" reads `new_units_sold` and `new_*_gross` instead of the retail totals; it
 * does not re-filter a total that has no split, which is what would have made the
 * figure wrong.
 */
export function buildSalesGross(filters: DashboardFilters): SalesGrossView {
  const scope = resolveStoreScope(filters)
  const periodContext = resolvePeriod(filters.period, filters.compare, reportingCalendar)
  const trend = salesGrossTrendRows()

  // `Certified` is a condition TYPE, not a condition GROUP: the export splits gross
  // into New and Used only, and a certified unit is Used. Selecting Certified
  // therefore narrows the deal-grain distribution but cannot narrow the summed gross
  // columns, and the route support declaration says exactly that.
  const conditionGroup =
    filters.condition === 'New' ? 'New' : filters.condition === 'Used' ? 'Used' : null
  const conditionFilterApplied = conditionGroup !== null
  const conditionPrefix =
    conditionGroup === 'New' ? 'new_' : conditionGroup === 'Used' ? 'used_' : ''
  const unitsColumn =
    conditionPrefix === 'new_'
      ? 'new_units_sold'
      : conditionPrefix === 'used_'
        ? 'used_units_sold'
        : 'retail_units_sold'
  const frontColumn = `${conditionPrefix}front_end_gross`
  const backColumn = `${conditionPrefix}back_end_gross`
  const totalColumn = `${conditionPrefix}total_gross`

  const targets = buildTargetContext(filters, periodContext.period, scope.ids)

  const current = trendRowsFor(trend, scope.ids, periodContext.period)
  const comparison =
    periodContext.comparison === null
      ? []
      : trendRowsFor(trend, scope.ids, periodContext.comparison)

  const performance: PerformanceMetric[] = [
    metric(
      'retail-units',
      'Retail units',
      'KPI-SLS-001',
      'units',
      current,
      comparison,
      (rows) => countFigure(rows, unitsColumn)
    ),
    metric(
      'new-units',
      'New units',
      'KPI-SLS-002',
      'units',
      current,
      comparison,
      (rows) => countFigure(rows, 'new_units_sold')
    ),
    metric(
      'used-units',
      'Used units',
      'KPI-SLS-003',
      'units',
      current,
      comparison,
      (rows) => countFigure(rows, 'used_units_sold')
    ),
    metric(
      'front-gross',
      'Front gross',
      'KPI-GRS-001',
      'USD',
      current,
      comparison,
      (rows) => currencyFigure(rows, frontColumn)
    ),
    metric(
      'back-gross',
      'Back gross',
      'KPI-GRS-002',
      'USD',
      current,
      comparison,
      (rows) => currencyFigure(rows, backColumn)
    ),
    metric(
      'total-gross',
      'Total gross',
      'KPI-GRS-003',
      'USD',
      current,
      comparison,
      (rows) => currencyFigure(rows, totalColumn)
    ),
    metric(
      'front-pvr',
      'Front PVR',
      'KPI-GRS-004',
      'USD per unit',
      current,
      comparison,
      (rows) => rateFigure(rows, frontColumn, unitsColumn)
    ),
    metric(
      'back-pvr',
      'Back PVR',
      'KPI-GRS-005',
      'USD per unit',
      current,
      comparison,
      (rows) => rateFigure(rows, backColumn, unitsColumn)
    ),
    metric(
      'total-pvr',
      'Total PVR',
      'KPI-GRS-006',
      'USD per unit',
      current,
      comparison,
      (rows) => rateFigure(rows, totalColumn, unitsColumn)
    ),
  ]

  const granularity = chooseGranularity(periodContext.period)
  const series: TrendSeries = {
    granularity,
    points: buildSeries(current, granularity),
    notice:
      granularity === 'monthly' && periodContext.period.wholeMonths.length === 0
        ? 'The selected range covers no whole month, so the monthly view may show partial months.'
        : null,
  }

  const mixes = buildMixes(current, scope)

  const front = currencyFigure(current, frontColumn)
  const back = currencyFigure(current, backColumn)
  const total = currencyFigure(current, totalColumn)
  const contribution = {
    front,
    back,
    frontShare:
      front.kind === 'value' && total.kind === 'value'
        ? shareOf(front.value, total.value)
        : null,
    backShare:
      back.kind === 'value' && total.kind === 'value'
        ? shareOf(back.value, total.value)
        : null,
  }

  const discounts: PerformanceMetric[] = [
    metric(
      'discount-original',
      'Discount from original asking',
      null,
      'USD per unit',
      current,
      comparison,
      (rows) => rateFigure(rows, 'discount_from_original_total', 'retail_units_sold')
    ),
    metric(
      'discount-final',
      'Discount from final asking',
      null,
      'USD per unit',
      current,
      comparison,
      (rows) => rateFigure(rows, 'discount_from_final_total', 'retail_units_sold')
    ),
    metric(
      'discount-msrp',
      'Discount from MSRP',
      null,
      'USD per unit',
      current,
      comparison,
      (rows) => msrpDiscount(rows)
    ),
  ]

  const deals = dealRowsFor(scope.ids, periodContext.period, filters)
  const distribution = buildDistribution(deals, 'total_gross')

  const bridge = buildBridge(
    grossChangeBridgeRows(),
    scope.ids,
    singleWholeMonth(periodContext.period)
  )

  return {
    scope,
    periodContext,
    asOfDate: dashboardManifest.asOfDate,
    chips: activeFilterChips(filters, SALES_GROSS_SUPPORT),
    empty: current.length === 0,
    performance,
    series,
    mixes,
    contribution,
    discounts,
    distribution,
    bridge,
    conditionFilterApplied,
    targets,
  }
}

/**
 * The MSRP discount, over its OWN denominator.
 *
 * `msrp_eligible_units` is smaller than `retail_units_sold` because a used unit has
 * no MSRP. Dividing by the retail count would understate the discount by counting
 * units the measure cannot apply to; when no unit in scope carries an MSRP the
 * measure is not applicable rather than zero.
 */
function msrpDiscount(rows: readonly DashboardRow[]): Figure {
  const eligible = sumColumn(rows, 'msrp_eligible_units')
  if (eligible === null) return { kind: 'no-rows' }
  if (isZero(eligible)) {
    return {
      kind: 'not-applicable',
      reason: 'No unit sold in this scope carries an MSRP.',
    }
  }
  return rateFigure(rows, 'discount_from_msrp_total', 'msrp_eligible_units')
}

function metric(
  id: string,
  label: string,
  kpiId: string | null,
  unit: string,
  current: readonly DashboardRow[],
  comparison: readonly DashboardRow[],
  compute: (rows: readonly DashboardRow[]) => Figure
): PerformanceMetric {
  const currentFigure = compute(current)
  const comparisonFigure =
    comparison.length === 0 ? { kind: 'no-rows' as const } : compute(comparison)
  const format =
    unit === 'units'
      ? (value: Exact) =>
          `${isNegative(value) ? '' : '+'}${formatCountExact(value)} units`
      : unit === 'USD per unit'
        ? (value: Exact) => formatPerUnitDifference(value)
        : (value: Exact) => formatCurrencyDifference(value)
  return {
    id,
    label,
    kpiId,
    unit,
    figure: {
      current: currentFigure,
      comparison: comparisonFigure,
      difference: difference(currentFigure, comparisonFigure, format),
    },
  }
}

function buildMixes(
  rows: readonly DashboardRow[],
  scope: StoreScope
): readonly MixBreakdown[] {
  const totalUnits = sumColumn(rows, 'retail_units_sold')
  const totalGross = sumColumn(rows, 'total_gross')

  const condition: MixRow[] = (
    [
      ['new', 'New', 'new_units_sold', 'new_total_gross'],
      ['used', 'Used', 'used_units_sold', 'used_total_gross'],
    ] as const
  ).map(([key, label, unitsColumn, grossColumn]) => {
    const units = sumColumn(rows, unitsColumn) ?? exactZero(0)
    const gross = sumColumn(rows, grossColumn) ?? exactZero(2)
    return {
      key,
      label,
      units: Number(exactToString(units)),
      gross,
      grossDisplay: formatCurrencyExact(gross),
      share: totalUnits === null ? null : shareOf(units, totalUnits),
    }
  })

  const byStore: MixRow[] = scope.stores.map((store) => {
    const storeRows = rows.filter((row) => textCell(row, 'dealership_id') === store.id)
    const units = sumColumn(storeRows, 'retail_units_sold') ?? exactZero(0)
    const gross = sumColumn(storeRows, 'total_gross') ?? exactZero(2)
    return {
      key: store.id,
      label: store.shortName,
      units: Number(exactToString(units)),
      gross,
      grossDisplay: formatCurrencyExact(gross),
      share: totalGross === null ? null : shareOf(gross, totalGross),
    }
  })

  // Sale-type mix is UNIT-ONLY. The dataset publishes per-sale-type unit counts but
  // no per-sale-type gross, and inventing one by apportioning the retail total would
  // be a measure the reporting layer does not own.
  const saleType: MixRow[] = (
    [
      ['lease', 'Lease', 'lease_units'],
      ['certified', 'Certified retail', 'certified_retail_units'],
      ['wholesale', 'Wholesale', 'wholesale_units'],
      ['dealer-trade', 'Dealer trade', 'dealer_trade_units'],
    ] as const
  ).map(([key, label, column]) => {
    const units = sumColumn(rows, column) ?? exactZero(0)
    return {
      key,
      label,
      units: Number(exactToString(units)),
      gross: exactZero(2),
      grossDisplay: 'Not published by sale type',
      share: null,
    }
  })

  return [
    {
      id: 'condition',
      title: 'New and used',
      rows: condition,
      note: 'Units and gross both split by the vehicle condition the export publishes. A certified pre-owned unit is Used.',
    },
    {
      id: 'store',
      title: 'By store',
      rows: byStore,
      note: 'Share is of total gross, not of units, so a store selling fewer but richer deals reads correctly.',
    },
    {
      id: 'sale-type',
      title: 'By sale type',
      rows: saleType,
      note: 'Unit counts only. The export publishes no per-sale-type gross, and apportioning the retail total across sale types would invent a measure the reporting layer does not own. Lease and certified retail units are already inside the retail count; wholesale and dealer trades are not.',
    },
  ]
}

/** The KPI catalogue entry behind a metric, for the methodology disclosure. */
export function kpiDefinition(kpiId: string): KpiEntry | undefined {
  return kpis.find((entry) => entry.id === kpiId)
}

/** Where a KPI id links to. */
export function kpiDefinitionHref(kpiId: string): string {
  return `/kpis#${kpiId}`
}
