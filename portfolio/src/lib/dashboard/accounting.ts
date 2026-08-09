/**
 * The accounting integrity model: the GL-versus-subledger comparison and its exceptions.
 *
 * WHAT THIS MODULE OWNS, AND WHAT IT REFUSES TO OWN
 * -------------------------------------------------
 * It owns SELECTION and PRESENTATION SHAPE: which comparison date a period resolves to,
 * which rows a store filter keeps, how the four comparison states are counted, and how the
 * exception classes are kept apart. It owns no arithmetic definition. Every balance and every
 * variance is read from the governed export exactly as `reporting.vw_inventory_gl_reconciliation`
 * produced it, and the only sums performed here are sums of already-signed variances.
 *
 * THE FOUR RULES THIS FILE EXISTS TO PROTECT
 * ------------------------------------------
 * 1. THE SIGN IS LOAD-BEARING. `variance_amount = gl_balance - subledger_balance`. Positive
 *    means the ledger carries more than the schedule supports. A group total is the sum of
 *    the SIGNED variances: +400.00 and -15.40 net to 384.60, and reporting 415.40 would
 *    describe a dealership that does not exist. `absolute_variance_amount` ranks, never totals.
 *
 * 2. A MISSING SIDE IS NULL, NEVER ZERO. Where one side has no balance the variance is null
 *    and `comparison_state` names the absent side. Nothing here coalesces a balance to zero:
 *    a missing GL balance and a GL balance of $0.00 are different facts about a dealership,
 *    and the second is far more alarming. Missing-side rows are excluded from the signed
 *    total and counted separately.
 *
 * 3. THE BALANCES ARE SEMI-ADDITIVE. They are stock figures at a date: additive across stores
 *    and control accounts on ONE comparison date, never across dates. A period resolves to the
 *    LAST comparable comparison date within it — never a sum, never an average. Summing them
 *    over a quarter would triple the inventory the group owns while looking entirely plausible.
 *
 * 4. A VARIANCE IS NOT A DATA-QUALITY FAILURE. The reconciliation states and the exception
 *    codes are different vocabularies over different populations, and no figure here adds
 *    them together.
 *
 * A NOTE ON WHAT THE NUMBERS MEAN AT ALL
 * --------------------------------------
 * Both sides are generated from one governed synthetic model. This is not agreement between
 * two independent systems, and the development dataset deliberately contains planted variance
 * scenarios so that all four states render. Neither fact is a caveat to be buried: the page
 * states both, and `CONTROLLED_SCENARIO_NOTE` is the sentence it uses.
 */
import type { DashboardRow } from '@/types/dashboard'

import { addExact, cellToExact, exactToString, exactZero, type Exact } from './decimal'
import type { DashboardFilters } from './filters'

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/** The four comparison states, exactly as the warehouse constrains them. */
export const COMPARISON_STATES = [
  'Reconciled',
  'Variance',
  'Missing GL balance',
  'Missing subledger balance',
] as const

export type ComparisonState = (typeof COMPARISON_STATES)[number]

/**
 * The disclosure every accounting surface carries.
 *
 * It is a constant rather than page prose so that the two routes that show it cannot drift
 * into saying different things about the same dataset.
 */
export const CONTROLLED_SCENARIO_NOTE =
  'Reconciliation exceptions in this fictional dataset include deliberately planted ' +
  'controlled scenarios used to prove the control surface. They are not discovered errors ' +
  'in a real dealership, and both sides are generated from one governed model rather than ' +
  'reconciled between two independent systems.'

/* -------------------------------------------------------------------------- */
/* Row shape                                                                   */
/* -------------------------------------------------------------------------- */

/** One store × control account × date comparison, decoded. */
export interface ComparisonRow {
  readonly dealershipId: string
  readonly comparisonDate: string
  readonly glAccountNumber: string
  readonly glAccountName: string
  readonly controlAccountCategory: string
  /** Null where the subledger side is absent. Never zero-substituted. */
  readonly subledgerBalance: Exact | null
  /** Null where the GL side is absent. Never zero-substituted. */
  readonly glBalance: Exact | null
  /** GL minus subledger. Null where either side is absent. */
  readonly varianceAmount: Exact | null
  readonly comparisonState: ComparisonState
  /** Whether both sides are present. False on exactly the two missing-side states. */
  readonly isComparable: boolean
  readonly stockUnitCount: number | null
  readonly floorplanPrincipal: Exact | null
}

function asComparisonState(value: unknown): ComparisonState {
  const found = COMPARISON_STATES.find((state) => state === value)
  if (found === undefined) {
    throw new Error(
      `unknown comparison state ${String(value)}; the export declares a closed set of four`
    )
  }
  return found
}

function asString(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new Error(`inventory-gl-reconciliation.${column} is not a string`)
  }
  return value
}

function asOptionalInteger(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/** Decode the exported rows into the shape the page renders. */
export function toComparisonRows(
  rows: readonly DashboardRow[]
): readonly ComparisonRow[] {
  return rows.map((row) => ({
    dealershipId: asString(row.dealership_id, 'dealership_id'),
    comparisonDate: asString(row.comparison_date, 'comparison_date'),
    glAccountNumber: asString(row.gl_account_number, 'gl_account_number'),
    glAccountName: asString(row.gl_account_name, 'gl_account_name'),
    controlAccountCategory: asString(
      row.control_account_category,
      'control_account_category'
    ),
    subledgerBalance: cellToExact(row.subledger_balance ?? null),
    glBalance: cellToExact(row.gl_balance ?? null),
    varianceAmount: cellToExact(row.variance_amount ?? null),
    comparisonState: asComparisonState(row.comparison_state),
    isComparable: row.is_comparable === true,
    stockUnitCount: asOptionalInteger(row.stock_unit_count),
    floorplanPrincipal: cellToExact(row.floorplan_principal ?? null),
  }))
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The comparison dates the export carries, newest first.
 *
 * Read from the rows rather than from the calendar: a date the reconciliation does not cover
 * is not a date this page may offer and then find empty.
 */
export function comparisonDates(rows: readonly ComparisonRow[]): readonly string[] {
  return [...new Set(rows.map((row) => row.comparisonDate))].sort().reverse()
}

/**
 * The comparison date a period selection resolves to, or null when the period covers none.
 *
 * THE LAST DATE IN THE PERIOD, NOT A SUM OVER IT. This is rule 3, implemented. A period that
 * contains three month-end comparisons has ONE answer — the last one — because a balance is a
 * position and positions do not accumulate.
 */
export function resolveComparisonDate(
  rows: readonly ComparisonRow[],
  filters: DashboardFilters
): string | null {
  const dates = comparisonDates(rows)
  if (dates.length === 0) return null

  // `dates` is newest-first, so the FIRST match inside a period is the LAST comparison date
  // within it — which is the semi-additive rule, not a convenience.
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
      // Both are relative windows the export's own calendar anchors, and both resolve to the
      // newest comparison date the reconciliation carries. A relative window that reached
      // past the last comparison would otherwise render empty rather than current.
      return dates[0] ?? null
  }
}

/**
 * The rows for one comparison date, narrowed by store.
 *
 * THE STORE FILTER APPLIES TO THE WHOLE ROW, which is the only way it can be applied. Each row
 * already carries both sides of one store's comparison, so there is no way for a filter to
 * narrow one side and not the other — the shape of the dataset forbids the bug rather than a
 * rule forbidding it.
 */
export function selectComparisons(
  rows: readonly ComparisonRow[],
  comparisonDate: string | null,
  filters: DashboardFilters
): readonly ComparisonRow[] {
  if (comparisonDate === null) return []
  const stores = new Set(filters.store)
  return rows
    .filter((row) => row.comparisonDate === comparisonDate)
    .filter((row) => stores.size === 0 || stores.has(row.dealershipId))
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                      */
/* -------------------------------------------------------------------------- */

/** The reconciliation position for one date and store selection. */
export interface ReconciliationSummary {
  readonly comparisonDate: string | null
  /** Sum of the subledger side over COMPARABLE positions only. */
  readonly subledgerTotal: Exact
  /** Sum of the GL side over COMPARABLE positions only. */
  readonly glTotal: Exact
  /** Sum of the SIGNED variances. Never a sum of absolute values. */
  readonly signedVariance: Exact
  readonly comparablePositions: number
  readonly reconciledPositions: number
  readonly variancePositions: number
  readonly missingGlPositions: number
  readonly missingSubledgerPositions: number
  /** Every position, comparable or not. */
  readonly totalPositions: number
}

/**
 * Total one date's comparison.
 *
 * MISSING-SIDE ROWS CONTRIBUTE TO NO TOTAL AND TO THEIR OWN COUNT. Including a one-sided row's
 * present balance in `glTotal` would make the two totals describe different populations, and
 * their difference would then be a number with no meaning at all — neither a variance nor a
 * balance. They are counted, named, and left out of the arithmetic.
 */
export function summarize(
  rows: readonly ComparisonRow[],
  comparisonDate: string | null
): ReconciliationSummary {
  let subledgerTotal = exactZero(2)
  let glTotal = exactZero(2)
  let signedVariance = exactZero(2)
  let comparablePositions = 0
  let reconciledPositions = 0
  let variancePositions = 0
  let missingGlPositions = 0
  let missingSubledgerPositions = 0

  for (const row of rows) {
    switch (row.comparisonState) {
      case 'Reconciled':
        reconciledPositions += 1
        break
      case 'Variance':
        variancePositions += 1
        break
      case 'Missing GL balance':
        missingGlPositions += 1
        break
      case 'Missing subledger balance':
        missingSubledgerPositions += 1
        break
    }

    if (!row.isComparable) continue
    comparablePositions += 1
    if (row.subledgerBalance !== null) {
      subledgerTotal = addExact(subledgerTotal, row.subledgerBalance)
    }
    if (row.glBalance !== null) glTotal = addExact(glTotal, row.glBalance)
    if (row.varianceAmount !== null) {
      signedVariance = addExact(signedVariance, row.varianceAmount)
    }
  }

  return {
    comparisonDate,
    subledgerTotal,
    glTotal,
    signedVariance,
    comparablePositions,
    reconciledPositions,
    variancePositions,
    missingGlPositions,
    missingSubledgerPositions,
    totalPositions: rows.length,
  }
}

/**
 * How a signed variance should be read, in words.
 *
 * The direction is published as text because a minus sign is not a description, and because
 * colour may not carry meaning on its own.
 */
export function varianceDirection(signed: Exact): string {
  const rendered = exactToString(signed)
  if (rendered.startsWith('-')) {
    return 'the subledger carries more than the general ledger'
  }
  if (/^0(\.0*)?$/.test(rendered)) return 'the two sides agree exactly'
  return 'the general ledger carries more than the subledger'
}

/* -------------------------------------------------------------------------- */
/* Exceptions                                                                  */
/* -------------------------------------------------------------------------- */

/** One accounting exception, decoded. */
export interface ExceptionRow {
  readonly exceptionId: string
  readonly exceptionCode: string
  /** What KIND of thing the exception is about. Governed vocabulary, not free text. */
  readonly entityName: string
  readonly dealershipId: string
  readonly exceptionDate: string
  readonly exceptionAmount: Exact | null
  readonly exceptionDetail: string
}

/** Decode the exported exception rows. */
export function toExceptionRows(rows: readonly DashboardRow[]): readonly ExceptionRow[] {
  return rows.map((row) => ({
    exceptionId: asString(row.exception_id, 'exception_id'),
    exceptionCode: asString(row.exception_code, 'exception_code'),
    entityName: asString(row.entity_name, 'entity_name'),
    dealershipId: asString(row.dealership_id, 'dealership_id'),
    exceptionDate: asString(row.exception_date, 'exception_date'),
    exceptionAmount: cellToExact(row.exception_amount ?? null),
    exceptionDetail: asString(row.exception_detail, 'exception_detail'),
  }))
}

/**
 * The drill-through destination for one exception, or null where none exists.
 *
 * DERIVED FROM THE GOVERNED ENTITY TYPE, NEVER GUESSED, AND BUILT FROM BUSINESS COLUMNS.
 * Every exception this view currently emits is at `gl_reconciliation` grain — the exception
 * is a property of a store-account-date position — so the destination is this same page,
 * narrowed to that store and that month, where the reader sees the position in its full
 * comparison context rather than as an isolated amount.
 *
 * An earlier revision mapped `vehicle` and `sale` to the inventory and deal routes. No row
 * carries either value, so every exception would have rendered linkless; and it read
 * `entity_key` to build the URL, whose values are warehouse surrogate composites. Both are
 * gone. When a later increment emits vehicle-grain or deal-grain exceptions, this function
 * is where those cases are added — with the business identifier the view publishes for them.
 *
 * An entity kind this console has no surface for returns null and the row renders as text.
 * A fabricated link that 404s is worse than an honest absence.
 */
export function exceptionDrillThrough(row: ExceptionRow): string | null {
  if (row.entityName === 'gl_reconciliation') {
    const month = row.exceptionDate.slice(0, 7)
    return `/dashboard/accounting?store=${encodeURIComponent(row.dealershipId)}&period=${month}`
  }
  return null
}

/** Exceptions for one store selection, in a stable order. */
export function selectExceptions(
  rows: readonly ExceptionRow[],
  filters: DashboardFilters
): readonly ExceptionRow[] {
  const stores = new Set(filters.store)
  const kept = rows.filter((row) => stores.size === 0 || stores.has(row.dealershipId))
  // Total and stable: exception_id is the business key, so it breaks every tie by itself.
  return [...kept].sort((a: ExceptionRow, b: ExceptionRow) =>
    a.exceptionId.localeCompare(b.exceptionId)
  )
}
