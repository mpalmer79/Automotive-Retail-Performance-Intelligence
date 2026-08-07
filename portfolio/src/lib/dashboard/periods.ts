/**
 * Period resolution, against the dataset's calendar rather than against the clock.
 *
 * THE DATASET'S AS-OF DATE IS AUTHORITATIVE
 * -----------------------------------------
 * The export's reporting window is a fixed six months ending 31 December 2025. The
 * machine rendering this page will, forever after that date, have a different idea
 * of "today". So there is no wall-clock read anywhere in this module: `mtd` means
 * the month containing the export's as-of date, `last-30d` means the thirty days
 * ending on it, and a request for a period the export does not cover is answered
 * with an explanation rather than with a screen of zeroes. Zero units sold is a
 * meaningful business answer and it must never be what "no data" looks like.
 *
 * A COMPARISON IS EITHER WHOLE OR ABSENT
 * --------------------------------------
 * The comparison window is not clamped. Clamping December against the five days of
 * November the export happened to contain would produce a difference that is
 * arithmetically correct and operationally meaningless, and the reader has no way
 * to see that it happened. Either the comparison window is entirely inside the
 * reporting window, or the page says which comparison it could not form and why.
 */
import { formatDateRange, formatIsoDate, lastDayOfMonth } from './format'
import type { CompareMode, PeriodSelection } from './filters'

/* -------------------------------------------------------------------------- */
/* Calendar arithmetic, in UTC                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `2025-12-31` → epoch day.
 *
 * `Date.UTC` on the parsed parts, never `new Date('2025-12-31')` in a local zone:
 * the string form parses as UTC midnight and then renders a day earlier west of
 * Greenwich, which on a figure labelled "as of" is a whole day of drift.
 */
function toEpochDay(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / 86_400_000
}

function fromEpochDay(day: number): string {
  const date = new Date(day * 86_400_000)
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${dayOfMonth}`
}

export function addDays(iso: string, days: number): string {
  return fromEpochDay(toEpochDay(iso) + days)
}

/** Inclusive length of a date range, in calendar days. */
export function dayCount(start: string, end: string): number {
  return toEpochDay(end) - toEpochDay(start) + 1
}

/** The same day one year earlier. 29 February resolves to 28 February. */
function minusOneYear(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (year === undefined || month === undefined || day === undefined) return iso
  const target = String(Number(year) - 1).padStart(4, '0')
  const limit = lastDayOfMonth(target, month)
  return `${target}-${month}-${day > limit ? limit : day}`
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

export interface ResolvedPeriod {
  readonly start: string
  readonly end: string
  /** Human label: "December 2025", "1–14 December 2025". */
  readonly label: string
  /** Every `YYYY-MM` the range touches — the partitions a chunked read needs. */
  readonly months: readonly string[]
  /** The months the range covers in full. Month-grain measures use only these. */
  readonly wholeMonths: readonly string[]
  readonly calendarDays: number
  /** Selling days, from the export's own calendar. */
  readonly sellingDays: number
}

export interface PeriodContext {
  readonly period: ResolvedPeriod
  readonly comparison: ResolvedPeriod | null
  /** Why no comparison was formed. `null` when one was, or when `compare=none`. */
  readonly comparisonUnavailable: string | null
  readonly compareMode: CompareMode
  /** Human-readable label for the comparison, always shown even when absent. */
  readonly comparisonLabel: string
  /** Notices raised while resolving — a clamped range, an unusable request. */
  readonly notices: readonly string[]
}

export interface CalendarWindow {
  readonly first: string
  readonly last: string
  readonly asOfDate: string
  readonly sellingDays: ReadonlySet<string>
}

/** Every `YYYY-MM` between two dates, inclusive. */
function monthsBetween(start: string, end: string): readonly string[] {
  const months: string[] = []
  let cursor = `${start.slice(0, 7)}-01`
  while (cursor <= end) {
    months.push(cursor.slice(0, 7))
    const [year, month] = cursor.split('-')
    if (year === undefined || month === undefined) break
    const nextMonth = Number(month) === 12 ? 1 : Number(month) + 1
    const nextYear = Number(month) === 12 ? Number(year) + 1 : Number(year)
    cursor = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`
  }
  return months
}

function describe(start: string, end: string, window: CalendarWindow): ResolvedPeriod {
  const months = monthsBetween(start, end)
  const wholeMonths = months.filter((month) => {
    const [year, monthPart] = month.split('-')
    if (year === undefined || monthPart === undefined) return false
    return `${month}-01` >= start && `${month}-${lastDayOfMonth(year, monthPart)}` <= end
  })
  let sellingDays = 0
  for (let day = toEpochDay(start); day <= toEpochDay(end); day += 1) {
    if (window.sellingDays.has(fromEpochDay(day))) sellingDays += 1
  }
  return {
    start,
    end,
    label: formatDateRange(start, end),
    months,
    wholeMonths,
    calendarDays: dayCount(start, end),
    sellingDays,
  }
}

/** The latest calendar month the export covers in full. The default period. */
export function latestWholeMonth(window: CalendarWindow): { start: string; end: string } {
  const months = monthsBetween(window.first, window.last)
  for (let index = months.length - 1; index >= 0; index -= 1) {
    const month = months[index]
    if (month === undefined) continue
    const [year, monthPart] = month.split('-')
    if (year === undefined || monthPart === undefined) continue
    const start = `${month}-01`
    const end = `${month}-${lastDayOfMonth(year, monthPart)}`
    if (start >= window.first && end <= window.last) return { start, end }
  }
  // No month is covered in full; the whole window is the honest answer.
  return { start: window.first, end: window.last }
}

/** The raw bounds a selection asks for, before any clamping. */
function requestedBounds(
  selection: PeriodSelection,
  window: CalendarWindow
): { start: string; end: string } {
  switch (selection.kind) {
    case 'default':
      return latestWholeMonth(window)
    case 'month': {
      const [year, month] = selection.month.split('-')
      if (year === undefined || month === undefined) return latestWholeMonth(window)
      return {
        start: `${selection.month}-01`,
        end: `${selection.month}-${lastDayOfMonth(year, month)}`,
      }
    }
    case 'range':
      return { start: selection.start, end: selection.end }
    case 'mtd':
      return { start: `${window.asOfDate.slice(0, 7)}-01`, end: window.asOfDate }
    case 'last-30d':
      return { start: addDays(window.asOfDate, -29), end: window.asOfDate }
  }
}

const COMPARE_LABELS: Readonly<Record<CompareMode, string>> = {
  'prior-period': 'Prior period',
  'prior-year': 'Prior year',
  none: 'No comparison',
}

/**
 * Resolve a filter's period and comparison against the export's calendar.
 *
 * Every branch that cannot give the reader what the URL asked for records a notice
 * naming the reporting window, so a deep link into 2019 renders December 2025 with
 * a sentence explaining the substitution rather than silently.
 */
export function resolvePeriod(
  selection: PeriodSelection,
  compareMode: CompareMode,
  window: CalendarWindow
): PeriodContext {
  const notices: string[] = []
  const requested = requestedBounds(selection, window)

  let start = requested.start
  let end = requested.end

  const windowLabel = `${formatIsoDate(window.first)} to ${formatIsoDate(window.last)}`

  if (end < window.first || start > window.last) {
    const fallback = latestWholeMonth(window)
    notices.push(
      `The requested period ${formatDateRange(requested.start, requested.end)} lies outside the exported reporting window (${windowLabel}), so the latest full month is shown instead.`
    )
    start = fallback.start
    end = fallback.end
  } else if (start < window.first || end > window.last) {
    const clampedStart = start < window.first ? window.first : start
    const clampedEnd = end > window.last ? window.last : end
    notices.push(
      `The requested period was trimmed to the exported reporting window (${windowLabel}); ${formatDateRange(clampedStart, clampedEnd)} is shown.`
    )
    start = clampedStart
    end = clampedEnd
  }

  const period = describe(start, end, window)

  if (compareMode === 'none') {
    return {
      period,
      comparison: null,
      comparisonUnavailable: null,
      compareMode,
      comparisonLabel: COMPARE_LABELS.none,
      notices,
    }
  }

  const comparisonBounds =
    compareMode === 'prior-year'
      ? { start: minusOneYear(period.start), end: minusOneYear(period.end) }
      : priorPeriodBounds(period, selection)

  if (comparisonBounds.start < window.first || comparisonBounds.end > window.last) {
    return {
      period,
      comparison: null,
      comparisonUnavailable: `The ${COMPARE_LABELS[compareMode].toLowerCase()} window (${formatDateRange(comparisonBounds.start, comparisonBounds.end)}) is outside the exported reporting window (${windowLabel}). Comparison figures are withheld rather than compared against a partial window.`,
      compareMode,
      comparisonLabel: COMPARE_LABELS[compareMode],
      notices,
    }
  }

  return {
    period,
    comparison: describe(comparisonBounds.start, comparisonBounds.end, window),
    comparisonUnavailable: null,
    compareMode,
    comparisonLabel: COMPARE_LABELS[compareMode],
    notices,
  }
}

/**
 * The window immediately before this one.
 *
 * A month selection compares against the previous CALENDAR month, not against the
 * previous 31 days: a general manager comparing December to November means the
 * month, and a 31-day window ending 30 November is neither month. Everything else
 * shifts back by its own length.
 */
function priorPeriodBounds(
  period: ResolvedPeriod,
  selection: PeriodSelection
): { start: string; end: string } {
  const isWholeMonth =
    period.wholeMonths.length === 1 &&
    period.start.endsWith('-01') &&
    selection.kind !== 'last-30d'
  if (isWholeMonth) {
    const previousEnd = addDays(period.start, -1)
    const [year, month] = previousEnd.split('-')
    if (year !== undefined && month !== undefined) {
      return { start: `${year}-${month}-01`, end: previousEnd }
    }
  }
  const length = period.calendarDays
  return { start: addDays(period.start, -length), end: addDays(period.start, -1) }
}

/** Build the calendar window from the export's own calendar dataset. */
export function calendarWindow(
  days: readonly { readonly date: string; readonly isSellingDay: boolean }[],
  asOfDate: string
): CalendarWindow {
  const sellingDays = new Set<string>()
  for (const day of days) if (day.isSellingDay) sellingDays.add(day.date)
  return {
    first: days[0]?.date ?? asOfDate,
    last: days[days.length - 1]?.date ?? asOfDate,
    asOfDate,
    sellingDays,
  }
}
