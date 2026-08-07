/**
 * Display formatting, applied only after an exact value has been resolved.
 *
 * THE ORDER MATTERS AND IS THE POINT
 * ----------------------------------
 * Every function here takes an {@link Exact} — a value that has already been
 * summed or divided exactly by `selectors.ts` — and turns it into a string. None
 * of them adds, and none of them is ever called on an operand. Rounding a figure
 * and then aggregating the rounded figure is how a dashboard ends up 0.4% away
 * from its own source and cannot say why.
 *
 * WHAT A UNIT IS ALLOWED TO CLAIM
 * -------------------------------
 * A percentage and a percentage point are different quantities, and conflating
 * them is the most common way a comparison line lies: conversion moving from 6.5%
 * to 7.2% is +0.7 percentage points and +10.8 percent, and only one of those is
 * what a general manager is being shown. So the difference formatters are separate
 * functions with separate names, and the suffix is written by the formatter rather
 * than by the caller.
 *
 * Pure. No data import, no React, safe in a client island.
 */
import type { Exact } from './decimal'
import { compareExact, exactToString, exactZero, isNegative, roundExact } from './decimal'

/* -------------------------------------------------------------------------- */
/* Group separators                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Insert thousands separators into the whole part of an exact string.
 *
 * Written by hand rather than through `Intl.NumberFormat`, because `Intl` takes a
 * `number` and the whole contract of this lane is that a gross figure never
 * becomes one. `1936571.59` has sixteen significant digits before the point on a
 * `portfolio`-profile export, and `Number` starts lying at seventeen.
 */
function groupDigits(text: string): string {
  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const point = unsigned.indexOf('.')
  const whole = point === -1 ? unsigned : unsigned.slice(0, point)
  const fraction = point === -1 ? '' : unsigned.slice(point)
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${fraction}`
}

/* -------------------------------------------------------------------------- */
/* Absolute values                                                             */
/* -------------------------------------------------------------------------- */

/** A whole count: `558`, `1,473`. */
export function formatCountExact(value: Exact): string {
  return groupDigits(exactToString(roundExact(value, 0)))
}

/**
 * Currency, USD.
 *
 * `decimals` defaults to 0 because a gross total on an executive card reads as a
 * figure, not as a ledger line; the cents are in the exact value and in the
 * disclosure, and `dashboard-executive.test.tsx` asserts against the exact string
 * rather than against this one.
 */
export function formatCurrencyExact(value: Exact, decimals = 0): string {
  const rounded = roundExact(value, decimals)
  const text = exactToString(rounded)
  const negative = text.startsWith('-')
  return `${negative ? '-' : ''}$${groupDigits(negative ? text.slice(1) : text)}`
}

/** Currency per retail unit: `$3,470`. Same rule, different label at the call site. */
export function formatPerUnitExact(value: Exact, decimals = 0): string {
  return formatCurrencyExact(value, decimals)
}

/**
 * A ratio rendered as a percentage: `0.0722` → `7.2%`.
 *
 * The ratio is multiplied by 100 by shifting the scale, never by multiplying a
 * float. `decimals` is the count of decimals in the PERCENTAGE, so one decimal on
 * a percentage needs three on the ratio.
 */
export function formatRatioAsPercent(value: Exact, decimals = 1): string {
  const shifted: Exact = { units: value.units, scale: Math.max(0, value.scale - 2) }
  const scaled =
    value.scale >= 2
      ? shifted
      : { units: value.units * 10n ** BigInt(2 - value.scale), scale: 0 }
  return `${exactToString(roundExact(scaled, decimals))}%`
}

/** Days, whole: `37 days`. */
export function formatDaysExact(value: Exact, decimals = 0): string {
  const text = exactToString(roundExact(value, decimals))
  return `${groupDigits(text)} ${text === '1' ? 'day' : 'days'}`
}

/** Minutes, one decimal: `77.6 minutes`. */
export function formatMinutesExact(value: Exact, decimals = 1): string {
  const text = exactToString(roundExact(value, decimals))
  return `${groupDigits(text)} minutes`
}

/** Turns per year, two decimals, annualization stated by the caller: `4.47`. */
export function formatTurnsExact(value: Exact, decimals = 2): string {
  return groupDigits(exactToString(roundExact(value, decimals)))
}

/* -------------------------------------------------------------------------- */
/* Differences                                                                 */
/* -------------------------------------------------------------------------- */

/** An explicit sign on a difference. Zero carries none. */
function signPrefix(value: Exact): string {
  const comparison = compareExact(value, exactZero(value.scale))
  if (comparison > 0) return '+'
  return ''
}

/** `+12 units`, `-4 units`, `0 units`. */
export function formatCountDifference(value: Exact, unit: string): string {
  const rounded = roundExact(value, 0)
  return `${signPrefix(rounded)}${groupDigits(exactToString(rounded))} ${unit}`
}

/** `+$18,420`, `-$18,420`. */
export function formatCurrencyDifference(value: Exact, decimals = 0): string {
  const rounded = roundExact(value, decimals)
  const text = exactToString(rounded)
  const negative = isNegative(rounded)
  const body = `$${groupDigits(negative ? text.slice(1) : text)}`
  if (negative) return `-${body}`
  return `${signPrefix(rounded)}${body}`
}

/** `+$84 per retail unit`. */
export function formatPerUnitDifference(value: Exact, decimals = 0): string {
  return `${formatCurrencyDifference(value, decimals)} per retail unit`
}

/**
 * `+3.1 percentage points`.
 *
 * Takes the difference of two RATIOS and states it in points, because that is what
 * the difference of two ratios is. There is deliberately no function on this module
 * that renders a ratio difference as a percentage: a relative change needs a
 * denominator decision the console has not been asked to make, and offering the
 * function is how the wrong one gets called.
 */
export function formatPointsDifference(value: Exact, decimals = 1): string {
  const shifted: Exact = { units: value.units, scale: Math.max(0, value.scale - 2) }
  const scaled =
    value.scale >= 2
      ? shifted
      : { units: value.units * 10n ** BigInt(2 - value.scale), scale: 0 }
  const rounded = roundExact(scaled, decimals)
  const magnitude = exactToString(rounded)
  // Only an exact whole 1 is singular. "1.0 percentage point" is not English, and
  // this formatter renders a decimal by default, so the singular is rare by design.
  const singular = magnitude === '1' || magnitude === '-1'
  return `${signPrefix(rounded)}${groupDigits(magnitude)} percentage ${
    singular ? 'point' : 'points'
  }`
}

/** `-4 days`, `+11 days`. */
export function formatDaysDifference(value: Exact, decimals = 0): string {
  const rounded = roundExact(value, decimals)
  const magnitude = exactToString(rounded)
  const singular = magnitude === '1' || magnitude === '-1'
  return `${signPrefix(rounded)}${groupDigits(magnitude)} ${singular ? 'day' : 'days'}`
}

/** `+6.4 minutes`. */
export function formatMinutesDifference(value: Exact, decimals = 1): string {
  const rounded = roundExact(value, decimals)
  return `${signPrefix(rounded)}${groupDigits(exactToString(rounded))} minutes`
}

/** `+0.42` turns. */
export function formatTurnsDifference(value: Exact, decimals = 2): string {
  const rounded = roundExact(value, decimals)
  return `${signPrefix(rounded)}${groupDigits(exactToString(rounded))} turns`
}

/* -------------------------------------------------------------------------- */
/* Dates and periods                                                           */
/* -------------------------------------------------------------------------- */

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/**
 * `2025-12-31` → `31 December 2025`.
 *
 * Formatted from the string's own parts. `new Date('2025-12-31')` parses as UTC
 * midnight and then renders in the reader's zone, which west of Greenwich prints
 * the thirtieth — a whole day of drift on a figure labelled "as of".
 */
export function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (year === undefined || month === undefined || day === undefined) return iso
  const name = MONTH_NAMES[Number(month) - 1]
  if (name === undefined) return iso
  return `${Number(day)} ${name} ${year}`
}

/** `2025-12` → `December 2025`. */
export function formatIsoMonth(iso: string): string {
  const [year, month] = iso.split('-')
  if (year === undefined || month === undefined) return iso
  const name = MONTH_NAMES[Number(month) - 1]
  if (name === undefined) return iso
  return `${name} ${year}`
}

/**
 * A date range in words.
 *
 * A whole calendar month says so — "December 2025" rather than "1 December 2025 to
 * 31 December 2025" — because a context header that spends two lines restating a
 * month is a context header a reader stops reading.
 */
export function formatDateRange(start: string, end: string): string {
  const startParts = start.split('-')
  const endParts = end.split('-')
  const [startYear, startMonth, startDay] = startParts
  const [endYear, endMonth, endDay] = endParts
  if (
    startYear !== undefined &&
    startMonth !== undefined &&
    startYear === endYear &&
    startMonth === endMonth &&
    startDay === '01' &&
    endDay === lastDayOfMonth(startYear, startMonth)
  ) {
    return formatIsoMonth(`${startYear}-${startMonth}`)
  }
  if (start === end) return formatIsoDate(start)
  if (startYear === endYear && startMonth === endMonth && endMonth !== undefined) {
    return `${Number(startDay)}–${Number(endDay)} ${formatIsoMonth(`${startYear}-${startMonth}`)}`
  }
  return `${formatIsoDate(start)} to ${formatIsoDate(end)}`
}

/** The last day of a month, as a two-digit string. */
export function lastDayOfMonth(year: string, month: string): string {
  const monthNumber = Number(month)
  const yearNumber = Number(year)
  const lengths = [
    31,
    isLeapYear(yearNumber) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  const length = lengths[monthNumber - 1]
  return length === undefined ? '01' : String(length).padStart(2, '0')
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}
