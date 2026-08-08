/**
 * Targets, attainment and selling-day pace: the console's view of the operating plan.
 *
 * WHAT THIS MODULE IS ALLOWED TO DO
 * ---------------------------------
 * It SELECTS exported rows and SUMS the additive columns the export declared as
 * numerators and denominators, then divides once, at the end, with the exact-decimal
 * helpers `DASH.2` established. That is the same standing the selector registry has
 * (ADR-0013 condition 2): the arithmetic is the export's, published as components
 * precisely so a consumer cannot form an average of averages, and this module is where
 * the two published components meet.
 *
 * It does NOT own a formula. The governed target-attainment reporting view decides what
 * an actual is, what a target is, how many selling days have elapsed and what the
 * projection is composed of. Nothing here re-derives any of that, and nothing here
 * counts a selling day: the governed date dimension's selling-day flag is the only
 * selling-day authority in ARPI (ADR-0002), the reporting layer counts it, and the
 * count crosses the JSON boundary as data.
 *
 * FIVE THINGS THAT ARE NOT THE SAME
 * ---------------------------------
 *   ACTUAL      what the store has done, month to date, on the sale-date basis
 *   TARGET      what it committed to
 *   ATTAINMENT  actual / target — NULL when there is no target, or the target is zero
 *   PACE        actual / selling days elapsed — NULL before the first selling day
 *   SELLING-DAY PACE PROJECTION
 *               pace × selling days in the month
 *
 * The projection is ARITHMETIC. Every surface that renders it says "Selling-day pace
 * projection". It is not a forecast, not a prediction, not AI, not machine learning,
 * not a probability and not a benchmark, and once a month is complete it equals the
 * final actual — which the console states rather than leaving the reader to notice.
 *
 * THE GROUP RULE, WHICH IS THE EASY THING TO GET WRONG
 * ----------------------------------------------------
 * A group attainment is SUM(numerator) / SUM(denominator), never the average of store
 * percentages, and the two sums must run over the SAME rows. A store with no plan
 * contributes neither: including its units while excluding its target would inflate the
 * group figure by exactly the units of the store that had no goal. `excludedStores`
 * carries the names so the page can say which stores are outside the ratio instead of
 * quietly answering a different question.
 *
 * THE COMPARABILITY RULE, WHICH IS THE LOAD-BEARING ONE
 * -----------------------------------------------------
 * A target is set at store-month scope over ALL retail deliveries. The moment a filter
 * changes the actual population without changing the target — Used only, one lead
 * source, one make, a sale-type scope, half a month — the percentage stays
 * arithmetically valid and becomes business-invalid. {@link targetComparability} is the
 * one place that decision is made, it names the filter responsible, and the page
 * renders its sentence instead of a number.
 */
import {
  addExact,
  cellToExact,
  compareExact,
  divideExact,
  exactFromInteger,
  exactZero,
  isNegative,
  isZero,
  multiplyByInteger,
  subtractExact,
  type Exact,
} from './decimal'
import { dashboardStores, numericCell, textCell, type DashboardStore } from './data'
import { DEFAULT_FILTERS, type DashboardFilters } from './filters'
import type { ResolvedPeriod } from './periods'
import { targetAttainmentRows } from './targets-data'

/* -------------------------------------------------------------------------- */
/* The governed vocabulary                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The exact label every projected month-end figure must carry.
 *
 * Declared once and imported by every surface that renders one, so the phrase cannot
 * drift into "forecast" in one component and stay correct in another. Asserted by both
 * the unit tests and the end-to-end suite.
 */
export const PACE_PROJECTION_LABEL = 'Selling-day pace projection'

/**
 * The synthetic-target disclosure, in the words the repository uses everywhere else.
 *
 * One visible statement per surface that shows a target. Not repeated beside every
 * card: a disclosure a reader has learned to skip has stopped disclosing.
 */
export const TARGET_DISCLOSURE =
  'Targets are synthetic internal operating goals for the fictional Granite Auto Group. ' +
  'They are not industry benchmarks, manufacturer objectives or any real dealership’s plan.'

/** The two measures the console carries target context for. */
export type TargetMeasureId = 'retailUnits' | 'totalGross'

interface TargetMeasureDefinition {
  readonly id: TargetMeasureId
  readonly label: string
  /** The metric the plan targets, as `target_kpi_id` names it on the exported row. */
  readonly targetKpiId: string
  /** The governed target KPI the target amount resolves to. */
  readonly targetKpi: string
  /** The governed attainment KPI. */
  readonly attainmentKpi: string
  /** The governed pace KPI. */
  readonly paceKpi: string
  /** The governed projection KPI. */
  readonly projectionKpi: string
  /** The KPI the actual itself resolves to, for the definition link. */
  readonly actualKpi: string
  readonly unit: 'count' | 'currency'
  /** Decimals the pace figure is displayed to. */
  readonly paceDecimals: number
}

/**
 * The two supported measures.
 *
 * Store scope only. The department rows the export also carries — the Sales
 * department's front-end gross plan and the Finance department's back-end gross plan —
 * are REFINEMENTS of the store's total-gross plan, not addends: front + back = total on
 * every sale row, so adding a department row to the store row counts the same gross
 * twice. `DASH.5` renders the store view; the department view belongs to a surface a
 * later increment owns.
 */
export const TARGET_MEASURES: readonly TargetMeasureDefinition[] = [
  {
    id: 'retailUnits',
    label: 'Retail units',
    targetKpiId: 'KPI-SLS-001',
    targetKpi: 'KPI-TGT-001',
    attainmentKpi: 'KPI-TGT-002',
    paceKpi: 'KPI-TGT-007',
    projectionKpi: 'KPI-TGT-009',
    actualKpi: 'KPI-SLS-001',
    unit: 'count',
    paceDecimals: 2,
  },
  {
    id: 'totalGross',
    label: 'Total gross',
    targetKpiId: 'KPI-GRS-003',
    targetKpi: 'KPI-TGT-003',
    attainmentKpi: 'KPI-TGT-004',
    paceKpi: 'KPI-TGT-008',
    projectionKpi: 'KPI-TGT-010',
    actualKpi: 'KPI-GRS-003',
    unit: 'currency',
    paceDecimals: 2,
  },
]

/** The store-scope value in the exported `target_scope_type` enumeration. */
const STORE_SCOPE = 'Store'

/* -------------------------------------------------------------------------- */
/* Comparability                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether the active filter context can be compared against the governed plan.
 *
 *   `comparable`      the actual population and the target scope agree
 *   `totals-only`     target and attainment hold; the selling-day clock does not,
 *                     because the period is more than one calendar month
 *   `not-comparable`  a filter changed the actual population and no target exists at
 *                     that scope. NOTHING is shown but the sentence.
 */
export type TargetComparabilityKind = 'comparable' | 'totals-only' | 'not-comparable'

export interface TargetComparability {
  readonly kind: TargetComparabilityKind
  /** Why, in one sentence a manager can act on. `null` only when fully comparable. */
  readonly reason: string | null
  /** The filter or period property responsible, for the test that plants each case. */
  readonly cause:
    | 'condition'
    | 'source'
    | 'scope'
    | 'make'
    | 'model'
    | 'partial-month'
    | 'multi-month'
    | null
}

const COMPARABLE: TargetComparability = { kind: 'comparable', reason: null, cause: null }

/**
 * Decide whether target context may be shown, and how much of it.
 *
 * The order matters: a filter that changes the actual population is fatal to the
 * comparison and is checked first, because a page that withheld only the pace and still
 * printed a percentage would have published the wrong number with a caveat about the
 * right one.
 *
 * @param filters The parsed filter state.
 * @param period The resolved period.
 * @returns What the surface may render, and why.
 */
export function targetComparability(
  filters: DashboardFilters,
  period: ResolvedPeriod
): TargetComparability {
  if (filters.condition !== null) {
    return {
      kind: 'not-comparable',
      cause: 'condition',
      reason: `Targets are set for all retail deliveries at store-month scope, so the plan has no ${filters.condition} component to compare a ${filters.condition}-only actual against. Target context is not comparable under the current condition filter.`,
    }
  }
  if (filters.source !== null) {
    return {
      kind: 'not-comparable',
      cause: 'source',
      reason:
        'Targets are set at store-month scope over every retail delivery, not per lead source. Comparing a single source’s deliveries against the whole store’s plan would produce a valid percentage of the wrong thing.',
    }
  }
  if (filters.scope !== DEFAULT_FILTERS.scope) {
    return {
      kind: 'not-comparable',
      cause: 'scope',
      reason: `Targets are set over every retail delivery at store-month scope, with no sale-type split. Comparing ${filters.scope}-only deliveries against the whole store’s plan would produce a valid percentage of the wrong thing.`,
    }
  }
  if (filters.make !== null) {
    return {
      kind: 'not-comparable',
      cause: 'make',
      reason:
        'Targets are set at store-month scope and are not defined for individual makes. Apportioning a store plan across makes would invent a target the reporting layer does not own.',
    }
  }
  if (filters.model !== null) {
    return {
      kind: 'not-comparable',
      cause: 'model',
      reason:
        'Targets are set at store-month scope and are not defined for individual models. Apportioning a store plan across models would invent a target the reporting layer does not own.',
    }
  }
  if (period.wholeMonths.length !== period.months.length || period.months.length === 0) {
    return {
      kind: 'not-comparable',
      cause: 'partial-month',
      reason:
        'The selected period does not cover whole calendar months. A monthly plan compared against part of a month understates attainment by however much of the month is missing, so target context is withheld rather than shown against a partial actual.',
    }
  }
  if (period.wholeMonths.length > 1) {
    return {
      kind: 'totals-only',
      cause: 'multi-month',
      reason: `Targets and attainment are summed across the ${String(period.wholeMonths.length)} selected months. Selling-day pace and the ${PACE_PROJECTION_LABEL.toLowerCase()} are single-month arithmetic: a pace blended across unrelated months is not a rate any month ran at, so both are withheld.`,
    }
  }
  return COMPARABLE
}

/* -------------------------------------------------------------------------- */
/* The resolved context                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One measure's target context, at whatever store scope the caller asked for.
 *
 * Every `Exact | null` here is a governed NULL rather than a missing value, and each
 * one means something different: `target` is null when NO TARGET IS SET, which is not
 * a target of zero; `attainment` is null when the target is absent or zero, because a
 * ratio over an empty denominator is undefined; `pace` and `projection` are null before
 * the first selling day, because a run rate over zero days is undefined.
 */
export interface TargetMeasureContext {
  readonly measure: TargetMeasureDefinition
  /** The actual, month to date, over every store in scope. Always present. */
  readonly actual: Exact
  /** The plan, summed over the stores that have one. `null` means no target set. */
  readonly target: Exact | null
  /** The attainment numerator: the actual of the stores that HAVE a target. */
  readonly attainmentNumerator: Exact
  /** The attainment denominator. `null` when no store in scope has a non-zero target. */
  readonly attainmentDenominator: Exact | null
  /** `attainmentNumerator / attainmentDenominator`, exact to six places. */
  readonly attainment: Exact | null
  /** Stores in scope with no plan, so the page can name them rather than hide them. */
  readonly excludedStores: readonly DashboardStore[]
  /** Units or dollars per governed selling day. `null` before the first selling day. */
  readonly pace: Exact | null
  /** The selling-day pace projection. `null` whenever the pace is. */
  readonly projection: Exact | null
  /** Signed difference between the projection and the target, when both exist. */
  readonly projectionVersusTarget: Exact | null
  /**
   * The same difference split into a magnitude and a direction word.
   *
   * Split HERE rather than in the component, because taking the absolute value of an
   * exact decimal is arithmetic, and no React component in this console performs any.
   * The direction is stated in neutral words — above, below, level — and never as a
   * verdict: ARPI has no governed favourable direction for these measures.
   */
  readonly projectionVersusTargetMagnitude: Exact | null
  readonly projectionVersusTargetDirection: 'above' | 'below' | 'level' | null
}

/** The selling-day clock, which is store-invariant: all three stores share it. */
export interface SellingDayClock {
  readonly elapsed: number
  readonly total: number
  readonly remaining: number
  readonly monthState: 'Not started' | 'In progress' | 'Complete'
  /** The as-of date the arithmetic was taken at, constrained to the month. */
  readonly effectiveAsOfDate: string
}

export interface TargetContext {
  readonly comparability: TargetComparability
  /** `null` when the comparability decision withheld everything. */
  readonly measures: readonly TargetMeasureContext[]
  /** `null` when the period is not a single calendar month, or nothing was selected. */
  readonly clock: SellingDayClock | null
  /** The month the plan belongs to, `YYYY-MM-DD`, or `null` for a multi-month total. */
  readonly targetMonth: string | null
  /** The stores the context covers, in business-code order. */
  readonly stores: readonly DashboardStore[]
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

interface TargetRow {
  readonly dealershipId: string
  readonly targetMonth: string
  readonly targetKpiId: string
  readonly isTargetPresent: boolean
  readonly target: Exact | null
  readonly actual: Exact
  readonly attainmentNumerator: Exact
  readonly attainmentDenominator: Exact | null
  readonly sellingDaysInMonth: number
  readonly sellingDaysElapsed: number
  readonly sellingDaysRemaining: number
  readonly projectionNumerator: Exact
  readonly monthState: string
  readonly effectiveAsOfDate: string
}

/** Every store-scope row, decoded once. Department rows are refinements and are not read here. */
function storeScopeRows(): readonly TargetRow[] {
  return targetAttainmentRows()
    .filter((row) => textCell(row, 'target_scope_type') === STORE_SCOPE)
    .map((row) => ({
      dealershipId: textCell(row, 'dealership_id'),
      targetMonth: textCell(row, 'target_month'),
      targetKpiId: textCell(row, 'target_kpi_id'),
      isTargetPresent: row.is_target_present === true,
      target: cellToExact(numericCell(row, 'target_value')),
      actual: cellToExact(numericCell(row, 'actual_mtd_value')) ?? exactZero(0),
      attainmentNumerator:
        cellToExact(numericCell(row, 'attainment_numerator')) ?? exactZero(0),
      attainmentDenominator: cellToExact(numericCell(row, 'attainment_denominator')),
      sellingDaysInMonth: integerCell(row, 'selling_days_in_month'),
      sellingDaysElapsed: integerCell(row, 'selling_days_elapsed'),
      sellingDaysRemaining: integerCell(row, 'selling_days_remaining'),
      projectionNumerator:
        cellToExact(numericCell(row, 'projection_numerator')) ?? exactZero(0),
      monthState: textCell(row, 'month_state'),
      effectiveAsOfDate: textCell(row, 'effective_as_of_date'),
    }))
}

function integerCell(row: Parameters<typeof numericCell>[0], column: string): number {
  const value = numericCell(row, column)
  if (typeof value !== 'number') {
    throw new Error(`Column "${column}" is not an exported integer on this row.`)
  }
  return value
}

let cachedRows: readonly TargetRow[] | undefined

function rows(): readonly TargetRow[] {
  cachedRows ??= storeScopeRows()
  return cachedRows
}

/**
 * Build the target context for a filter state.
 *
 * @param filters The parsed filter state, for the comparability decision.
 * @param period The resolved period, which fixes the months and the whole-month rule.
 * @param storeIds The stores in scope, in business-code order.
 * @returns The context. When comparability is `not-comparable`, `measures` is empty and
 *   the page renders the reason instead of any figure.
 */
export function buildTargetContext(
  filters: DashboardFilters,
  period: ResolvedPeriod,
  storeIds: readonly string[]
): TargetContext {
  const comparability = targetComparability(filters, period)
  const stores = dashboardStores.filter((store) => storeIds.includes(store.id))

  if (comparability.kind === 'not-comparable') {
    return { comparability, measures: [], clock: null, targetMonth: null, stores }
  }

  const months = new Set(period.wholeMonths.map((month) => `${month}-01`))
  const inScope = rows().filter(
    (row) => storeIds.includes(row.dealershipId) && months.has(row.targetMonth)
  )

  const singleMonth = comparability.kind === 'comparable'
  const clock = singleMonth ? sellingDayClock(inScope) : null
  const targetMonth = singleMonth ? (inScope[0]?.targetMonth ?? null) : null

  const measures = TARGET_MEASURES.map((measure) =>
    buildMeasure(
      measure,
      inScope.filter((row) => row.targetKpiId === measure.targetKpiId),
      stores,
      clock
    )
  )

  return { comparability, measures, clock, targetMonth, stores }
}

/**
 * The selling-day clock for a single month.
 *
 * Store-invariant by construction: `vw_target_attainment` counts
 * `dim_date.is_selling_day`, which all three stores share, so every row of one month
 * carries the same three numbers. Taking the first row's is therefore reading the
 * governed value, not choosing between candidates — and the assertion below is what
 * makes that claim checkable rather than assumed.
 */
function sellingDayClock(inScope: readonly TargetRow[]): SellingDayClock | null {
  const first = inScope[0]
  if (first === undefined) return null
  for (const row of inScope) {
    if (
      row.sellingDaysElapsed !== first.sellingDaysElapsed ||
      row.sellingDaysInMonth !== first.sellingDaysInMonth
    ) {
      throw new Error(
        'The exported selling-day clock differs between two rows of one month. The ' +
          'governed date dimension is the only selling-day authority and is shared by ' +
          'all three stores, so this is export drift rather than a store difference.'
      )
    }
  }
  return {
    elapsed: first.sellingDaysElapsed,
    total: first.sellingDaysInMonth,
    remaining: first.sellingDaysRemaining,
    monthState: first.monthState as SellingDayClock['monthState'],
    effectiveAsOfDate: first.effectiveAsOfDate,
  }
}

function buildMeasure(
  measure: TargetMeasureDefinition,
  measureRows: readonly TargetRow[],
  stores: readonly DashboardStore[],
  clock: SellingDayClock | null
): TargetMeasureContext {
  // The actual over EVERY store in scope. This is the headline business result and it
  // does not change because a store has no plan.
  const actual = measureRows.reduce(
    (total, row) => addExact(total, row.actual),
    exactZero(0)
  )

  // The ratio's two sides, over the SAME subset: only rows carrying a usable
  // denominator contribute, and each contributes both its numerator and its
  // denominator. A store whose units entered the numerator while its absent target
  // stayed out of the denominator would inflate the group figure by exactly its units.
  const withTarget = measureRows.filter((row) => row.attainmentDenominator !== null)
  const attainmentNumerator = withTarget.reduce(
    (total, row) => addExact(total, row.attainmentNumerator),
    exactZero(0)
  )
  const attainmentDenominator =
    withTarget.length === 0
      ? null
      : withTarget.reduce(
          (total, row) => addExact(total, row.attainmentDenominator as Exact),
          exactZero(0)
        )

  // The plan itself, summed over the rows that carry one. Distinct from the
  // denominator: a zero target is a plan and is summed here, and is excluded from the
  // denominator because dividing by it is undefined.
  const planned = measureRows.filter((row) => row.isTargetPresent && row.target !== null)
  const target =
    planned.length === 0
      ? null
      : planned.reduce((total, row) => addExact(total, row.target as Exact), exactZero(0))

  const plannedStores = new Set(planned.map((row) => row.dealershipId))
  const excludedStores = stores.filter((store) => !plannedStores.has(store.id))

  const attainment =
    attainmentDenominator === null
      ? null
      : divideExact(attainmentNumerator, attainmentDenominator, 6)

  // Pace and projection are single-month arithmetic; `clock` is null whenever the
  // period is not one calendar month, and both are withheld rather than blended.
  const pace =
    clock === null || clock.elapsed === 0
      ? null
      : divideExact(actual, exactFromInteger(clock.elapsed), 6)
  const projectionNumerator = measureRows.reduce(
    (total, row) => addExact(total, row.projectionNumerator),
    exactZero(0)
  )
  const projection =
    clock === null || clock.elapsed === 0
      ? null
      : divideExact(projectionNumerator, exactFromInteger(clock.elapsed), 6)

  const projectionVersusTarget =
    projection === null || target === null ? null : subtractExact(projection, target)

  return {
    measure,
    actual,
    target,
    attainmentNumerator,
    attainmentDenominator,
    attainment,
    excludedStores,
    pace,
    projection,
    projectionVersusTarget,
    projectionVersusTargetMagnitude:
      projectionVersusTarget === null
        ? null
        : isNegative(projectionVersusTarget)
          ? subtractExact(exactZero(projectionVersusTarget.scale), projectionVersusTarget)
          : projectionVersusTarget,
    projectionVersusTargetDirection:
      projectionVersusTarget === null
        ? null
        : isZero(projectionVersusTarget)
          ? 'level'
          : isNegative(projectionVersusTarget)
            ? 'below'
            : 'above',
  }
}

/* -------------------------------------------------------------------------- */
/* Per-store context, for the scoreboard                                       */
/* -------------------------------------------------------------------------- */

export interface StoreTargetContext {
  readonly storeId: string
  readonly measures: readonly TargetMeasureContext[]
  readonly clock: SellingDayClock | null
}

/**
 * One row of target context per store, for the scoreboard's pace cell.
 *
 * Built by calling {@link buildTargetContext} once per store rather than by a second
 * aggregation path, so a store cell and the group card can never disagree about what a
 * store's attainment is.
 */
export function buildStoreTargetContexts(
  filters: DashboardFilters,
  period: ResolvedPeriod,
  storeIds: readonly string[]
): readonly StoreTargetContext[] {
  return storeIds.map((storeId) => {
    const context = buildTargetContext(filters, period, [storeId])
    return { storeId, measures: context.measures, clock: context.clock }
  })
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The bar's fill fraction, clamped to `[0, 1]`, for layout only.
 *
 * A pixel cannot carry twenty significant digits and no displayed figure goes through
 * here: the attainment percentage beside the bar is rendered from the exact ratio. The
 * clamp is what keeps a 134% attainment from painting a bar a third wider than its
 * track; the OVERFLOW is reported separately so the bar can mark it rather than hide it.
 */
export function paceBarGeometry(
  numerator: Exact | null,
  denominator: Exact | null
): { readonly fill: number; readonly overflow: boolean } {
  if (numerator === null || denominator === null) return { fill: 0, overflow: false }
  if (denominator.units === 0n) return { fill: 0, overflow: false }
  const ratio = divideExact(numerator, denominator, 4)
  if (ratio === null) return { fill: 0, overflow: false }
  const one = { units: 10n ** 4n, scale: 4 }
  if (compareExact(ratio, one) >= 0) return { fill: 1, overflow: true }
  if (ratio.units <= 0n) return { fill: 0, overflow: false }
  return { fill: Number(ratio.units) / 10_000, overflow: false }
}

/**
 * How far through the month the selling-day clock has run, for layout only.
 *
 * `multiplyByInteger` is imported for the same reason `format.ts` takes an `Exact`:
 * the marker's position is geometry, and the numbers it is derived from stay exact.
 */
export function sellingDayProgress(clock: SellingDayClock | null): number {
  if (clock === null || clock.total === 0) return 0
  const elapsed = multiplyByInteger(exactFromInteger(clock.elapsed), 1n)
  const ratio = divideExact(elapsed, exactFromInteger(clock.total), 4)
  if (ratio === null) return 0
  return Number(ratio.units) / 10_000
}
