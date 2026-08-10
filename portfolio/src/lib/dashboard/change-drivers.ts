/**
 * The governed gross-change bridge, and the display policy `DASH.12` puts in front of it.
 *
 * ONE AUTHORITY, THREE SURFACES
 * -----------------------------
 * `vw_gross_change_bridge` owns the decomposition: which components exist, the sequential
 * order they are applied in, and the arithmetic that produces each effect. This
 * module does not re-derive any of that. It verifies the identity the view guarantees --
 * that the three numerators sum to denominator x change, exactly, with no division on
 * either side -- and then divides for display.
 *
 * `buildBridge` was written for `DASH.3` and lived inside `sales-gross.ts` until `DASH.12`
 * needed the same numbers on two more surfaces. It moved here rather than being called
 * across module boundaries: `sales-gross.ts` imports a 95 kB trend dataset that neither the
 * Executive Overview nor the Action Center has any use for, and an import is a graph edge
 * whether or not anything reads what it pulls in. The function is unchanged by the move.
 *
 * WHAT `DASH.12` ADDS
 * -------------------
 * A materiality policy, and only a policy. `buildChangeDrivers` takes the bridge exactly as
 * `buildBridge` produced it and decides which components are large enough to list. Anything
 * below the threshold is GROUPED into one labelled remainder -- never dropped -- together
 * with the cent-level residual that rounding three exact quotients leaves behind. The
 * grouped total is stated, so the components a reader sees plus the remainder still add up
 * to the period change exactly. That property is the whole point: a decomposition that does
 * not reconcile is a set of numbers, not a bridge.
 *
 * The threshold itself is configured in `config/dashboard/action_rules.yaml` and travels in
 * the export manifest. There is no numeric literal for it anywhere in TypeScript.
 *
 * NOT CAUSATION
 * -------------
 * "The bridge attributes", "the decomposition assigns", "contribution". Never "caused",
 * "because", "drove" or "resulted from". A sequential decomposition apportions an observed
 * change between components in a documented order; change the order and the apportionment
 * changes, which is precisely why it is not a causal claim. A test asserts the vocabulary.
 *
 * Pure: no React, no `window`, no data import.
 */
import type { DashboardRow } from '@/types/dashboard'

import {
  addExact,
  cellToExact,
  compareExact,
  divideExact,
  exactToString,
  exactZero,
  isNegative,
  isZero,
  multiplyByInteger,
  subtractExact,
  sumExact,
  type Exact,
} from './decimal'
import { numericCell, textCell } from './data'
import { formatCurrencyDifference, formatCurrencyExact, formatIsoMonth } from './format'

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
export function buildBridge(
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
/* DASH.12 — the management change-driver view                                 */
/* -------------------------------------------------------------------------- */

/** One component a reader sees, or the grouped remainder standing for several. */
export interface ChangeDriverEffect {
  readonly code: string
  readonly label: string
  readonly amount: Exact
  readonly display: string
  /** True for the grouped remainder, which stands for effects too small to list. */
  readonly grouped: boolean
  /** Which component codes the remainder absorbed. Empty for a listed component. */
  readonly absorbed: readonly string[]
}

export type ChangeDriverState =
  | {
      readonly kind: 'available'
      readonly monthLabel: string
      readonly change: Exact
      readonly changeDisplay: string
      readonly effects: readonly ChangeDriverEffect[]
      /** The materiality threshold as configured, for disclosure. */
      readonly materiality: { readonly display: string; readonly label: string }
      /** True when the listed effects and the remainder sum EXACTLY to the change. */
      readonly reconciles: boolean
      /** True when the exported numerators satisfied the view's own identity. */
      readonly verified: boolean
      readonly statement: string
    }
  | {
      readonly kind: 'unavailable'
      readonly reason: string
      readonly monthLabel: string | null
      readonly change: Exact | null
      readonly changeDisplay: string | null
    }

/**
 * Apply the materiality display policy to a bridge.
 *
 * The remainder absorbs two different things and says so: components below the threshold,
 * and the residual left by rounding each exact quotient to the cent. Both are real parts of
 * the change, and neither is large enough to list on its own. What is NOT permitted is
 * absorbing either into a component that IS listed, which would misstate that component.
 *
 * `reconciles` is computed rather than assumed. It is asserted by test on every fixture,
 * and rendered honestly if it were ever false.
 */
export function buildChangeDrivers(
  bridge: BridgeState,
  materiality: { readonly value: string; readonly label: string }
): ChangeDriverState {
  if (bridge.kind === 'unavailable') return bridge

  const floor = cellToExact(materiality.value)
  const listed: ChangeDriverEffect[] = []
  const absorbed: string[] = []
  let remainder = exactZero(bridge.change.scale)

  for (const component of bridge.components) {
    // Magnitude decides, not sign: a large negative contribution is as material as a large
    // positive one, and grouping by signed value would hide exactly the wrong half.
    const material = floor === null || compareExact(absoluteExact(component.amount), floor) >= 0
    if (material) {
      listed.push({ ...component, grouped: false, absorbed: [] })
    } else {
      absorbed.push(component.code)
      remainder = addExact(remainder, component.amount)
    }
  }

  // Whatever the listed effects do not account for IS the remainder. Deriving it by
  // subtraction rather than by addition is what makes the reconciliation exact by
  // construction instead of exact by luck.
  const residual = subtractExact(
    bridge.change,
    sumExact(listed.map((effect) => effect.amount))
  )
  const effects = [...listed]
  if (!isZero(residual)) {
    effects.push({
      code: 'below_threshold',
      label:
        absorbed.length > 0
          ? 'Effects below the review threshold'
          : 'Rounding of the exact components',
      amount: residual,
      display: formatCurrencyDifference(residual),
      grouped: true,
      absorbed,
    })
  }

  const reconciles =
    compareExact(sumExact(effects.map((effect) => effect.amount)), bridge.change) === 0

  return {
    kind: 'available',
    monthLabel: bridge.monthLabel,
    change: bridge.change,
    changeDisplay: formatCurrencyDifference(bridge.change),
    effects,
    materiality: {
      display: formatCurrencyExact(floor ?? exactZero(2)),
      label: materiality.label,
    },
    reconciles,
    verified: bridge.verified,
    statement: bridge.statement,
  }
}

function absoluteExact(value: Exact): Exact {
  return isNegative(value) ? subtractExact(exactZero(value.scale), value) : value
}
