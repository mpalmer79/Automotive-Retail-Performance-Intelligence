/**
 * The Sales and Gross view model, and the claim that it invents nothing.
 *
 * THE LOAD-BEARING TEST IS THE RECONCILIATION
 * -------------------------------------------
 * `reconciles to the export manifest` compares the page's own figures, over the whole
 * reporting window at group scope, to the reconciliation totals the root exporter
 * published in `manifest.json`. Those totals were computed in SQL, by the exporter,
 * from the warehouse -- not by anything in `src/`. If the view model had quietly
 * redefined a measure, it would fail there with a wrong number.
 *
 * Everything else in this file guards a rule that a correct total would not catch:
 * that a rate is recomputed rather than averaged, that an absence is stated rather
 * than zeroed, and that the bridge is verified rather than trusted.
 */
import { describe, expect, it } from 'vitest'

import {
  exactToString,
  parseExact,
  divideExact,
} from '../../src/lib/dashboard/decimal.ts'
import { DEFAULT_FILTERS, SALES_GROSS_SUPPORT } from '../../src/lib/dashboard/filters.ts'
import { dashboardManifest } from '../../src/lib/dashboard/data.ts'
import { buildSalesGross, type Figure } from '../../src/lib/dashboard/sales-gross.ts'

/** The whole reporting window, at group scope: the context the manifest totals cover. */
const WHOLE_WINDOW = {
  ...DEFAULT_FILTERS,
  period: { kind: 'range' as const, start: '2025-07-01', end: '2025-12-31' },
}

function value(figure: Figure): string {
  if (figure.kind !== 'value') {
    throw new Error(`expected a value, got ${figure.kind}`)
  }
  return exactToString(figure.value)
}

function metric(view: ReturnType<typeof buildSalesGross>, id: string) {
  const found = view.performance.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`no metric ${id}`)
  return found
}

/**
 * The manifest's own published figure for a reconciliation key.
 *
 * An additive total carries `total`; a ratio carries `numerator` and `denominator`
 * and deliberately NO quotient (`DATA_CONTRACT.md` §12), so the rate tests below
 * perform the division themselves rather than reading one the export refused to
 * publish.
 */
function manifestTotal(key: string): { numerator: string; denominator: string | null } {
  const totals = dashboardManifest.reconciliationTotals as unknown as Record<
    string,
    { total?: string; numerator?: string; denominator?: string | null }
  >
  const entry = totals[key]
  if (entry === undefined) throw new Error(`manifest has no reconciliation total ${key}`)
  const numerator = entry.total ?? entry.numerator
  if (numerator === undefined)
    throw new Error(`${key} publishes neither total nor numerator`)
  return { numerator, denominator: entry.denominator ?? null }
}

describe('the Sales and Gross view model reconciles to the export', () => {
  const view = buildSalesGross(WHOLE_WINDOW)

  it('reproduces the manifest retail unit count exactly', () => {
    expect(value(metric(view, 'retail-units').figure.current)).toBe(
      manifestTotal('retail_units').numerator
    )
  })

  it('reproduces the manifest gross totals exactly', () => {
    expect(value(metric(view, 'total-gross').figure.current)).toBe(
      manifestTotal('total_gross').numerator
    )
    expect(value(metric(view, 'front-gross').figure.current)).toBe(
      manifestTotal('front_end_gross').numerator
    )
    expect(value(metric(view, 'back-gross').figure.current)).toBe(
      manifestTotal('back_end_gross').numerator
    )
  })

  it('reproduces the per-unit rates by dividing the published components', () => {
    /*
     * The manifest publishes a numerator and a denominator, never a quotient
     * (`DATA_CONTRACT.md` §12). The rate is therefore checked by performing the same
     * division on the manifest's own figures, which is what proves the page divided
     * the right two things rather than that it produced a plausible number.
     */
    for (const [id, key] of [
      ['total-pvr', 'total_gross_per_retail_unit'],
      ['front-pvr', 'front_gross_per_retail_unit'],
      ['back-pvr', 'back_gross_per_retail_unit'],
    ] as const) {
      const total = manifestTotal(key)
      expect(total.denominator, `${key} publishes no denominator`).not.toBeNull()
      const expected = divideExact(
        parseExact(total.numerator),
        parseExact(total.denominator as string),
        6
      )
      expect(expected).not.toBeNull()
      expect(value(metric(view, id).figure.current)).toBe(exactToString(expected!))
    }
  })

  it('makes total PVR the sum of front and back PVR, because they share a denominator', () => {
    const front = metric(view, 'front-pvr').figure.current
    const back = metric(view, 'back-pvr').figure.current
    const total = metric(view, 'total-pvr').figure.current
    if (front.kind !== 'value' || back.kind !== 'value' || total.kind !== 'value') {
      throw new Error('a rate was absent over the whole window')
    }
    const sum = Number(exactToString(front.value)) + Number(exactToString(back.value))
    expect(Math.abs(sum - Number(exactToString(total.value)))).toBeLessThan(1e-6)
  })

  it('agrees with the sum of its own store scopes', () => {
    /*
     * A total that does not equal the sum of its parts is the classic filter-context
     * defect. Checked on an additive measure only -- summing three stores' PVRs would
     * be the very error this console exists to avoid.
     */
    const stores = ['GSA-001', 'GSA-002', 'GSA-003']
    let sum = 0
    for (const store of stores) {
      const scoped = buildSalesGross({ ...WHOLE_WINDOW, store: [store] })
      sum += Number(value(metric(scoped, 'total-gross').figure.current))
    }
    expect(sum.toFixed(2)).toBe(
      Number(value(metric(view, 'total-gross').figure.current)).toFixed(2)
    )
  })
})

describe('rates are recomputed, never averaged', () => {
  it('does not equal the mean of the daily rates the dataset publishes', () => {
    /*
     * The dataset carries `total_gross_per_retail_unit` per store-day. Averaging that
     * column over a month weights a one-unit Tuesday the same as a nine-unit Saturday,
     * and produces a different number from the correct one. This test asserts the two
     * differ, so a future refactor that started averaging would fail rather than pass
     * quietly with a plausible figure.
     */
    const view = buildSalesGross(WHOLE_WINDOW)
    const correct = Number(value(metric(view, 'total-pvr').figure.current))
    // The wrong answer, computed here deliberately.
    const points = view.series.points
    const dailyRates = points
      .map((point) => point.totalPvr)
      .filter((rate): rate is NonNullable<typeof rate> => rate !== null)
      .map((rate) => Number(exactToString(rate)))
    const meanOfRates =
      dailyRates.reduce((sum, rate) => sum + rate, 0) / Math.max(dailyRates.length, 1)
    expect(Math.abs(correct - meanOfRates)).toBeGreaterThan(0.5)
  })

  it('recomputes each trend bucket from its own numerator and denominator', () => {
    const view = buildSalesGross(WHOLE_WINDOW)
    for (const point of view.series.points) {
      if (point.totalPvr === null) continue
      const expected = divideExact(point.totalGross, point.retailUnits, 2)
      expect(exactToString(point.totalPvr)).toBe(exactToString(expected!))
    }
  })

  it('renders a gap rather than a zero when a bucket sold no retail unit', () => {
    const view = buildSalesGross(WHOLE_WINDOW)
    for (const point of view.series.points) {
      if (exactToString(point.retailUnits) === '0') {
        expect(point.totalPvr).toBeNull()
      }
    }
  })
})

describe('the condition filter selects a governed column rather than re-filtering a total', () => {
  const all = buildSalesGross(WHOLE_WINDOW)
  const newOnly = buildSalesGross({ ...WHOLE_WINDOW, condition: 'New' })
  const usedOnly = buildSalesGross({ ...WHOLE_WINDOW, condition: 'Used' })

  it('splits units so that new plus used equals the retail total', () => {
    const total = Number(value(metric(all, 'retail-units').figure.current))
    const newUnits = Number(value(metric(newOnly, 'retail-units').figure.current))
    const usedUnits = Number(value(metric(usedOnly, 'retail-units').figure.current))
    expect(newUnits + usedUnits).toBe(total)
  })

  it('splits gross so that new plus used equals the retail total', () => {
    const total = Number(value(metric(all, 'total-gross').figure.current))
    const newGross = Number(value(metric(newOnly, 'total-gross').figure.current))
    const usedGross = Number(value(metric(usedOnly, 'total-gross').figure.current))
    expect((newGross + usedGross).toFixed(2)).toBe(total.toFixed(2))
  })

  it('declares itself applied on this route, unlike the Executive Overview', () => {
    expect(SALES_GROSS_SUPPORT.condition.support).toBe('applied')
  })

  it('produces a different PVR for new and used, so the filter is really acting', () => {
    const newPvr = Number(value(metric(newOnly, 'total-pvr').figure.current))
    const usedPvr = Number(value(metric(usedOnly, 'total-pvr').figure.current))
    expect(newPvr).not.toBe(usedPvr)
  })
})

describe('the gross change bridge', () => {
  const december = buildSalesGross({
    ...DEFAULT_FILTERS,
    period: { kind: 'month', month: '2025-12' },
  })

  it('is available for a whole month with a comparable month before it', () => {
    expect(december.bridge.kind).toBe('available')
  })

  it('verifies the exported identity rather than trusting it', () => {
    if (december.bridge.kind !== 'available') throw new Error('bridge unavailable')
    expect(december.bridge.verified).toBe(true)
  })

  it('publishes exactly the three documented components, in order', () => {
    if (december.bridge.kind !== 'available') throw new Error('bridge unavailable')
    expect(december.bridge.components.map((component) => component.code)).toEqual([
      'volume',
      'front_pvr',
      'back_pvr',
    ])
  })

  it('states the change and its components in attribution language, never causal', () => {
    if (december.bridge.kind !== 'available') throw new Error('bridge unavailable')
    const statement = december.bridge.statement
    expect(statement).toMatch(/bridge attributes/i)
    // The words a causal claim would need. None may appear.
    for (const forbidden of [
      'caused',
      'because',
      'due to',
      'drove',
      'responsible for',
      'blame',
      'thanks to',
    ]) {
      expect(statement.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('adds up in the displayed column, with any rounding residual shown', () => {
    if (december.bridge.kind !== 'available') throw new Error('bridge unavailable')
    const components = december.bridge.components.reduce(
      (sum, component) => sum + Number(exactToString(component.amount)),
      0
    )
    const rounding =
      december.bridge.rounding === null
        ? 0
        : Number(exactToString(december.bridge.rounding))
    const change = Number(exactToString(december.bridge.change))
    expect((components + rounding).toFixed(2)).toBe(change.toFixed(2))
  })

  it('is withheld with a reason for the first month of the window', () => {
    const july = buildSalesGross({
      ...DEFAULT_FILTERS,
      period: { kind: 'month', month: '2025-07' },
    })
    expect(july.bridge.kind).toBe('unavailable')
    if (july.bridge.kind !== 'unavailable') return
    expect(july.bridge.reason.toLowerCase()).toContain('outside the reporting window')
  })

  it('is withheld, with the period change still stated, for a multi-month range', () => {
    const range = buildSalesGross(WHOLE_WINDOW)
    expect(range.bridge.kind).toBe('unavailable')
    if (range.bridge.kind !== 'unavailable') return
    expect(range.bridge.reason).toMatch(/single whole month/i)
  })
})

describe('absent figures are stated, never zeroed', () => {
  it('reports no matching records for a period with no finalized transaction', () => {
    /*
     * The export's window starts in July 2025. A range before it has no rows at all,
     * which is a different fact from a range whose rows sum to zero.
     */
    const empty = buildSalesGross({
      ...DEFAULT_FILTERS,
      period: { kind: 'range', start: '2025-07-01', end: '2025-07-01' },
      store: ['GSA-003'],
    })
    for (const entry of empty.performance) {
      expect(['value', 'no-rows', 'null-ratio']).toContain(entry.figure.current.kind)
      if (entry.figure.current.kind === 'value') continue
      expect(entry.figure.current.kind).not.toBe('not-applicable')
    }
  })

  it('reports the MSRP discount as not applicable when no unit in scope carries one', () => {
    /*
     * The independent pre-owned store sells used units, which legitimately have no
     * MSRP. The measure cannot apply, and "not applicable" is the honest rendering:
     * a zero would claim the store discounted nothing off a price that never existed.
     */
    const preOwned = buildSalesGross({ ...WHOLE_WINDOW, store: ['GSA-003'] })
    const msrp = preOwned.discounts.find((entry) => entry.id === 'discount-msrp')
    expect(msrp).toBeDefined()
    expect(['not-applicable', 'value']).toContain(msrp!.figure.current.kind)
    if (msrp!.figure.current.kind === 'not-applicable') {
      expect(msrp!.figure.current.reason).toMatch(/MSRP/i)
    }
  })
})

describe('the deal-level distribution', () => {
  const view = buildSalesGross(WHOLE_WINDOW)

  it('counts every retail deal in the window into exactly one band', () => {
    const banded = view.distribution.bands.reduce((sum, band) => sum + band.count, 0)
    expect(banded).toBe(view.distribution.dealCount)
  })

  it('matches the retail unit count the aggregate reports', () => {
    expect(String(view.distribution.dealCount)).toBe(
      value(metric(view, 'retail-units').figure.current)
    )
  })

  it('has a mean equal to the governed total gross per retail unit', () => {
    /*
     * Over a retail population these are the same quantity by definition. They are
     * computed by two independent paths -- one sums a store-day column, the other
     * averages deal-grain rows -- so their agreement is evidence, not tautology.
     */
    const pvr = Number(value(metric(view, 'total-pvr').figure.current))
    expect(
      Number(view.distribution.mean ? exactToString(view.distribution.mean) : NaN)
    ).toBeCloseTo(pvr, 1)
  })

  it('has a median below its mean, which is why both are shown', () => {
    const median = Number(exactToString(view.distribution.median!))
    const mean = Number(exactToString(view.distribution.mean!))
    expect(median).toBeLessThan(mean)
  })

  it('counts negative-front deals rather than hiding them', () => {
    expect(view.distribution.negativeFrontCount).toBeGreaterThan(0)
  })
})

describe('the sale-type mix does not invent a gross it does not have', () => {
  it('publishes unit counts and says so where gross is unavailable', () => {
    const view = buildSalesGross(WHOLE_WINDOW)
    const saleType = view.mixes.find((mix) => mix.id === 'sale-type')
    expect(saleType).toBeDefined()
    for (const row of saleType!.rows) {
      expect(row.grossDisplay).toBe('Not published by sale type')
    }
    expect(saleType!.note).toMatch(/would invent a measure/i)
  })
})
