/**
 * The absence vocabulary, exact summation and the order statistic — shared by every console
 * route that publishes a governed figure.
 *
 * WHY THIS MODULE EXISTS, AND WHAT IT IS NOT
 * ------------------------------------------
 * These four things were written for `/dashboard/leads-marketing` (`DASH.10`) and lived in
 * `leads-marketing.ts`. `DASH.11` needs all four for `/dashboard/employees`, and the only two
 * alternatives were both worse than moving them: importing a thousand lines of BDC selector
 * logic into a route that reads none of it, or writing a second median.
 *
 * A SECOND MEDIAN IS THE ONE OUTCOME THAT WAS NOT AVAILABLE. `percentileFromBins` reproduces
 * PostgreSQL's `percentile_cont` interpolation exactly so the console and the database cannot
 * disagree, and `RECON-EMP-SOURCE-MEDIAN` and `RECON-LEAD-RESPONSE-DIST-MEDIAN` both assert
 * that equality against the database. Two copies of it would be two chances to drift from the
 * thing those rules prove, and the drift would be invisible: both would return a plausible
 * number of seconds.
 *
 * This is an extraction and not a rewrite. `leads-marketing.ts` re-exports every name it used
 * to own, so nothing that imported them had to change, and the behaviour is byte-identical.
 *
 * PURE FUNCTIONS ONLY. Nothing here reads a dataset, so importing it costs a route no data.
 */
import type { DashboardRow } from '@/types/dashboard'

import { numericCell } from './data'
import { addExact, cellToExact, divideExact, exactZero, type Exact } from './decimal'

/* -------------------------------------------------------------------------- */
/* Absence                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Why a figure is not a number, in the project's absence vocabulary.
 *
 * `DATA_CONTRACT.md`'s absence rule, applied here rather than collapsed into one dash:
 *
 *   not-applicable       structurally meaningless. Cost per lead for a walk-in. Gross per
 *                        retail unit for a BDC representative, who delivers no cars.
 *   no-data              the measurement is expected and absent. No responded leads yet.
 *   not-at-this-grain    data exists elsewhere but this contract cannot support the claim.
 *   insufficient-sample  the measurement applies, the denominator is real, and it is below
 *                        the governed minimum-sample floor the export publishes as data. `DASH.11` added this one.
 *   zero                 a real observed zero, which is a VALUE and never an absence.
 *
 * Collapsing any two of these is how a console stops being trustworthy in a way nobody can
 * point at: "$0 cost per lead" and "no cost per lead" are different statements about a
 * walk-in, and only one of them is true. The fifth distinction matters most on the employee
 * route, where "$0 gross per unit", "no gross per unit" and "six units, minimum ten" are three
 * different things to say about a person and only the last one is honest.
 *
 * INSUFFICIENT SAMPLE IS A PUBLICATION STATE, NOT A VERDICT. It says the project declines to
 * print a comparative ratio over a denominator this small. It says nothing whatever about the
 * person, and nothing may style it as a failure.
 */
export type AbsenceKind =
  | 'not-applicable'
  | 'no-data'
  | 'not-at-this-grain'
  | 'insufficient-sample'

export interface Absent {
  readonly kind: AbsenceKind
  readonly reason: string
}

export type Figure = { readonly kind: 'value'; readonly value: Exact } | Absent

export function figure(value: Exact): Figure {
  return { kind: 'value', value }
}

export function absent(kind: AbsenceKind, reason: string): Figure {
  return { kind, reason }
}

export function isFigure(
  candidate: Figure
): candidate is { kind: 'value'; value: Exact } {
  return candidate.kind === 'value'
}

/** Divide, carrying the absence forward rather than substituting a number for it. */
export function ratio(
  numerator: Exact,
  denominator: Exact,
  scale: number,
  reason: string
): Figure {
  const result = divideExact(numerator, denominator, scale)
  return result === null ? absent('no-data', reason) : figure(result)
}

/* -------------------------------------------------------------------------- */
/* Summation                                                                   */
/* -------------------------------------------------------------------------- */

/** Sum one additive exported column across rows. Integers stay integers. */
export function sumColumn(rows: readonly DashboardRow[], column: string): Exact {
  let total = exactZero(0)
  for (const row of rows) {
    const cell = numericCell(row, column)
    if (cell === null) continue
    const value = cellToExact(cell)
    if (value !== null) total = addExact(total, value)
  }
  return total
}

/* -------------------------------------------------------------------------- */
/* Order statistics                                                            */
/* -------------------------------------------------------------------------- */

/**
 * An order statistic over an exported population, weighted by each bin's count.
 *
 * THIS IS THE ONLY WAY A MEDIAN MAY BE FORMED IN THIS CONSOLE. A median does not decompose:
 * the median of a month is not the average of its daily medians, not the average of its store
 * medians, and not a weighted blend of either — all three are different numbers and all three
 * are wrong. `lead-response` publishes medians at store x source x day and they cannot be
 * combined, which is why both routes that publish one read a DISTRIBUTION instead.
 *
 * `percentile_cont` is linear-interpolated, and this reproduces it exactly so the console and
 * PostgreSQL cannot disagree: with N observations the rank is `p x (N - 1)` counted from zero,
 * and a fractional rank interpolates between the two values it falls between.
 *
 * Bins with a null response value are the NEVER-RESPONDED population and are excluded by the
 * caller before this is reached. Including them as zero would sort the ignored leads to the
 * fastest end and improve the median, which is the defect both routes' tests seed explicitly.
 */
export function percentileFromBins(
  bins: readonly { readonly value: number; readonly count: number }[],
  percentile: number,
  scale: number
): Exact | null {
  const ordered = [...bins]
    .filter((bin) => bin.count > 0)
    .sort((a, b) => a.value - b.value)
  const total = ordered.reduce((sum, bin) => sum + bin.count, 0)
  if (total === 0) return null

  const rank = percentile * (total - 1)
  const lowerIndex = Math.floor(rank)
  const upperIndex = Math.ceil(rank)

  const at = (index: number): number => {
    let seen = 0
    for (const bin of ordered) {
      seen += bin.count
      if (index < seen) return bin.value
    }
    const last = ordered[ordered.length - 1]
    return last === undefined ? 0 : last.value
  }

  const lower = at(lowerIndex)
  const upper = at(upperIndex)
  const fraction = rank - lowerIndex
  const seconds = lower + (upper - lower) * fraction

  // Seconds are integers in the export and the interpolation is at most a half step, so the
  // arithmetic is exact well inside double precision. It is carried to `Exact` here, before
  // any display, so the value that reaches the page is the exact one.
  const factor = 10 ** scale
  return { units: BigInt(Math.round(seconds * factor)), scale }
}
