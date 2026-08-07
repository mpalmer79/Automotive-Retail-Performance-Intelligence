/**
 * Exact decimal arithmetic for the console, on `bigint`.
 *
 * WHY NOT `Number`
 * ----------------
 * `src/types/dashboard.ts` states the rule the export was built around: a currency
 * value crosses the JSON boundary as a string, "precisely so that no JavaScript
 * number ever touches a gross figure". `0.1 + 0.2` is the canonical demonstration
 * of why; the practical one here is that `1936571.59` is a sum of 357 daily figures
 * and a console that reproduces it to fifteen places and then disagrees with the
 * export in the sixteenth has not reproduced it.
 *
 * So every value this module handles is `{ units: bigint, scale: number }` — the
 * digits as an integer, and where the point sits. Addition rescales to the wider
 * operand and adds. Division is the only operation that has to choose, and it says
 * so in its signature: a caller passes the scale it wants and gets half-up rounding
 * away from zero at that scale, which is the convention `display_precision` in the
 * export manifest was written for.
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * Not a KPI layer. It has no idea what a gross figure is. It adds, subtracts,
 * divides and compares, and every decision about *which* columns may be added is
 * made in `selectors.ts` against the export's own governed metadata (ADR-0013
 * condition 2). A general-purpose calculator cannot redefine a KPI; only a caller
 * that invents a formula can, and that is why the formulas live in one tested file
 * rather than in this one.
 */

/** A decimal held exactly: `units × 10^-scale`. */
export interface Exact {
  readonly units: bigint
  readonly scale: number
}

/** The parse rule, stated once: optional sign, digits, optional fraction. */
const DECIMAL_PATTERN = /^[+-]?\d+(?:\.\d+)?$/

/** Zero at a given scale. */
export function exactZero(scale = 0): Exact {
  return { units: 0n, scale }
}

/**
 * Parse an exported decimal string.
 *
 * Throws rather than returning a fallback. A value that reached this function and
 * is not a decimal came out of a dataset file, which means the generator's
 * validation missed it — and rendering `0` for it would put a wrong number on a
 * page that exists to be trustworthy.
 */
export function parseExact(value: string): Exact {
  const text = value.trim()
  if (!DECIMAL_PATTERN.test(text)) {
    throw new Error(`Not an exact decimal: ${JSON.stringify(value)}`)
  }
  const negative = text.startsWith('-')
  const unsigned = text.replace(/^[+-]/, '')
  const point = unsigned.indexOf('.')
  const digits =
    point === -1 ? unsigned : unsigned.slice(0, point) + unsigned.slice(point + 1)
  const scale = point === -1 ? 0 : unsigned.length - point - 1
  const units = BigInt(digits)
  return { units: negative ? -units : units, scale }
}

/**
 * Read a cell that may be a string decimal, a JSON number, or null.
 *
 * The export carries three shapes deliberately: currency and exact ratios are
 * strings, order statistics are JSON numbers because PostgreSQL computed them as
 * doubles and claiming decimal precision they never had would be a lie, and a null
 * is a null. `null` propagates; anything else is a contract violation and throws.
 */
export function cellToExact(cell: string | number | boolean | null): Exact | null {
  if (cell === null) return null
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) throw new Error(`Not a finite number: ${String(cell)}`)
    return parseExact(String(cell))
  }
  if (typeof cell === 'string') return parseExact(cell)
  throw new Error(`Not a numeric cell: ${String(cell)}`)
}

/** Restate a value at a wider scale. Never narrows: narrowing would round. */
function widen(value: Exact, scale: number): Exact {
  if (scale === value.scale) return value
  if (scale < value.scale) throw new Error('widen() cannot narrow a scale')
  return { units: value.units * 10n ** BigInt(scale - value.scale), scale }
}

/** Bring two values to a common scale. */
function align(a: Exact, b: Exact): readonly [Exact, Exact] {
  const scale = Math.max(a.scale, b.scale)
  return [widen(a, scale), widen(b, scale)]
}

export function addExact(a: Exact, b: Exact): Exact {
  const [left, right] = align(a, b)
  return { units: left.units + right.units, scale: left.scale }
}

export function subtractExact(a: Exact, b: Exact): Exact {
  const [left, right] = align(a, b)
  return { units: left.units - right.units, scale: left.scale }
}

/** −1, 0 or 1. */
export function compareExact(a: Exact, b: Exact): number {
  const [left, right] = align(a, b)
  if (left.units < right.units) return -1
  if (left.units > right.units) return 1
  return 0
}

export function isZero(value: Exact): boolean {
  return value.units === 0n
}

export function isNegative(value: Exact): boolean {
  return value.units < 0n
}

/** Sum a list exactly. An empty list is zero at scale 0, not null. */
export function sumExact(values: readonly Exact[]): Exact {
  let total = exactZero(0)
  for (const value of values) total = addExact(total, value)
  return total
}

/**
 * Divide, at a scale the caller names, rounding half away from zero.
 *
 * `null` when the denominator is zero. Not `Infinity`, not `0`, not a sentinel:
 * KPI_CATALOG.md says of every ratio in the console that "zero denominator returns
 * BLANK()/NULL", and the whole point of that rule is that an empty lot has no
 * average age rather than an average age of zero.
 */
export function divideExact(
  numerator: Exact,
  denominator: Exact,
  scale: number
): Exact | null {
  if (denominator.units === 0n) return null
  /*
   * n / d, expressed at `scale`, is
   *
   *   round( n.units × 10^(d.scale − n.scale + scale) / d.units )
   *
   * and the exponent can go either way, so whichever side needs the factor gets
   * it. Doing it as one integer division keeps the rounding decision on real
   * digits: there is no intermediate quotient to round twice.
   */
  const exponent = denominator.scale - numerator.scale + scale
  const liftedNumerator =
    exponent >= 0 ? numerator.units * 10n ** BigInt(exponent) : numerator.units
  const liftedDenominator =
    exponent >= 0 ? denominator.units : denominator.units * 10n ** BigInt(-exponent)
  return { units: divideRoundHalfUp(liftedNumerator, liftedDenominator), scale }
}

/** Integer division rounding half away from zero. */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('divideRoundHalfUp: zero denominator')
  const negative = numerator < 0n !== denominator < 0n
  const absNumerator = numerator < 0n ? -numerator : numerator
  const absDenominator = denominator < 0n ? -denominator : denominator
  const quotient = absNumerator / absDenominator
  const remainder = absNumerator % absDenominator
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient
  return negative ? -rounded : rounded
}

/** Round to a scale, half away from zero. Widening is exact. */
export function roundExact(value: Exact, scale: number): Exact {
  if (scale >= value.scale) return widen(value, scale)
  const divisor = 10n ** BigInt(value.scale - scale)
  return { units: divideRoundHalfUp(value.units, divisor), scale }
}

/** Multiply by a whole number. Used only where a governed formula annualizes. */
export function multiplyByInteger(value: Exact, factor: bigint): Exact {
  return { units: value.units * factor, scale: value.scale }
}

/** The canonical string form: sign, digits, point, exactly `scale` decimals. */
export function exactToString(value: Exact): string {
  const negative = value.units < 0n
  const digits = (negative ? -value.units : value.units).toString()
  if (value.scale === 0) return `${negative ? '-' : ''}${digits}`
  const padded = digits.padStart(value.scale + 1, '0')
  const whole = padded.slice(0, padded.length - value.scale)
  const fraction = padded.slice(padded.length - value.scale)
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

/**
 * An approximate `number`, for geometry only.
 *
 * A bar width and a funnel segment length are pixels, and a pixel cannot carry
 * twenty significant digits. Every call site is a layout calculation; no displayed
 * figure goes through here, which `dashboard-executive.test.tsx` asserts by
 * comparing rendered text against the exact strings instead.
 */
export function exactToApproxNumber(value: Exact): number {
  return Number(exactToString(value))
}

/** Build an exact integer. */
export function exactFromInteger(value: number | bigint): Exact {
  return { units: BigInt(value), scale: 0 }
}
