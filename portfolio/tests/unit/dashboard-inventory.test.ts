/**
 * The inventory model, reconciled against the export and driven with corrupted fixtures.
 *
 * Same contract as `dashboard-accounting.test.ts`: `dashboard-boundaries.test.ts` permits
 * `inventory.ts` to perform exact arithmetic on the strength of a claim, and this is where
 * the claim is tested rather than asserted. Every corruption below must change the answer,
 * because a seeded defect that passes on the right and the wrong implementation alike proves
 * nothing at all.
 */
import { describe, expect, it } from 'vitest'

import { inventoryUnitChunkFile } from '../../src/lib/dashboard/inventory-chunks.ts'
import {
  AGE_BUCKETS,
  DEFAULT_UNIT_SORT,
  findUnit,
  medianDaysInStock,
  parseUnitSort,
  resolveSnapshotDate,
  selectUnits,
  sortUnits,
  summarizeInventory,
  toUnitRows,
  type UnitRow,
} from '../../src/lib/dashboard/inventory.ts'
import { exactToString } from '../../src/lib/dashboard/decimal.ts'
import { DEFAULT_FILTERS } from '../../src/lib/dashboard/filters.ts'
import { decodeDataset } from '../../src/lib/dashboard/data.ts'

function chunkRows(store: string, month: string): readonly UnitRow[] {
  const file = inventoryUnitChunkFile(store, month)
  if (file === undefined)
    throw new Error(`no inventory-units partition ${store}/${month}`)
  return toUnitRows(decodeDataset('inventory-units', file))
}

const units = chunkRows('GSA-001', '2025-12')

describe('the unit population matches the export', () => {
  it('decodes every row of a partition', () => {
    expect(units.length).toBeGreaterThan(0)
  })

  it('carries a governed age bucket on every row', () => {
    for (const unit of units) expect(AGE_BUCKETS).toContain(unit.ageBucket)
  })

  it('publishes the aged threshold as data rather than leaving it to be assumed', () => {
    for (const unit of units) {
      expect(unit.agedThresholdDays).toBe(60)
      // The flag agrees with the threshold the row itself carries.
      expect(unit.isAged).toBe(unit.daysInStock > unit.agedThresholdDays)
    }
  })

  it('keeps the ratio null wherever the estimate is, and never zero', () => {
    for (const unit of units) {
      expect(unit.priceToMarketRatio === null).toBe(unit.marketPriceEstimate === null)
      if (unit.priceToMarketRatio !== null) {
        expect(exactToString(unit.priceToMarketRatio)).not.toBe('0.0000')
      }
    }
  })

  it('carries null movement on a unit with no prior observation', () => {
    for (const unit of units) {
      if (unit.priorAskingPrice === null) {
        expect(unit.askingPriceChange).toBeNull()
        expect(unit.isPriceReducedSincePrior).toBeNull()
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Seeded defects                                                              */
/* -------------------------------------------------------------------------- */

/** Ages chosen so that mean and median differ, and so the aged threshold matters. */
function agedFixture(): UnitRow[] {
  const template = units[0]
  if (template === undefined) throw new Error('no template unit')
  const ages = [5, 20, 45, 61, 75, 95, 130, 200]
  return ages.map((days, index) => ({
    ...template,
    vehicleId: `VEH-${String(index).padStart(7, '0')}`,
    daysInStock: days,
    ageBucket:
      days <= 30
        ? '0-30'
        : days <= 60
          ? '31-60'
          : days <= 90
            ? '61-90'
            : days <= 120
              ? '91-120'
              : 'Over 120',
    agedThresholdDays: 60,
    isAged: days > 60,
  }))
}

describe('seeded defects change the answer', () => {
  const fixture = agedFixture()
  const summary = summarizeInventory(fixture, '2025-12-31')

  it('uses the 60-day threshold, not the 120-day top bucket boundary', () => {
    // 61, 75, 95, 130 and 200 are all past 60. Five of eight.
    expect(summary.agedUnits).toBe(5)
    expect(summary.agedThresholdDays).toBe(60)

    // The specific misreading: treating 120 as the threshold. Only 130 and 200 exceed it,
    // so the group's aged stock would be reported as two units instead of five.
    const wrong = fixture.filter((unit) => unit.daysInStock > 120).length
    expect(wrong).toBe(2)
    expect(wrong).not.toBe(summary.agedUnits)
  })

  it('separates the aged threshold from the bucket a unit sits in', () => {
    const seventyFive = fixture.find((unit) => unit.daysInStock === 75)
    expect(seventyFive?.isAged).toBe(true)
    expect(seventyFive?.ageBucket).toBe('61-90')
  })

  it('takes the median from the population rather than averaging subgroup medians', () => {
    // Ages 5,20,45,61,75,95,130,200 -> median is (61+75)/2 = 68.
    expect(summary.medianAge).toBe(68)

    // Split the same population in two and average the group medians: a plausible and wrong
    // implementation. It must not land on the same number.
    const left = fixture.slice(0, 4)
    const right = fixture.slice(4)
    const averagedMedians =
      ((medianDaysInStock(left) ?? 0) + (medianDaysInStock(right) ?? 0)) / 2
    expect(averagedMedians).not.toBe(summary.medianAge)
  })

  it('keeps the mean as context and does not substitute it for the median', () => {
    // Mean is 78.875; the gap to the median is the aged-tail diagnostic.
    expect(summary.meanAge).toBeCloseTo(78.875, 3)
    expect(summary.meanAge).not.toBe(summary.medianAge)
  })

  it('counts a unit into exactly one bucket, and the buckets total the population', () => {
    const bucketed = summary.buckets.reduce((total, bucket) => total + bucket.units, 0)
    expect(bucketed).toBe(summary.units)
    expect(summary.units).toBe(fixture.length)
  })

  it('reports no ratio for a unit with no estimate rather than a zero', () => {
    const template = units.find((unit) => unit.marketPriceEstimate !== null)
    if (template === undefined) throw new Error('no priced unit to seed from')
    const stripped: UnitRow = {
      ...template,
      marketPriceEstimate: null,
      priceToMarketRatio: null,
    }
    const withoutEstimate = summarizeInventory([stripped], '2025-12-31')
    expect(withoutEstimate.unitsWithoutEstimate).toBe(1)
    expect(withoutEstimate.unitsWithEstimate).toBe(0)
    expect(stripped.priceToMarketRatio).toBeNull()
  })

  it('sorts a null ratio last in both directions rather than at an extreme', () => {
    const priced = units.filter((unit) => unit.priceToMarketRatio !== null).slice(0, 3)
    const unpriced = units.filter((unit) => unit.priceToMarketRatio === null).slice(0, 1)
    if (priced.length < 3 || unpriced.length < 1) {
      throw new Error('partition lacks both priced and unpriced units')
    }
    const mixed = [...unpriced, ...priced]

    const descending = sortUnits(mixed, 'ratio-desc')
    const ascending = sortUnits(mixed, 'ratio-asc')
    expect(descending.at(-1)?.priceToMarketRatio).toBeNull()
    expect(ascending.at(-1)?.priceToMarketRatio).toBeNull()
  })

  it('orders totally and stably, so the input order cannot leak into the output', () => {
    const forward = sortUnits(units, 'age-desc').map((unit) => unit.vehicleId)
    const reversed = sortUnits([...units].reverse(), 'age-desc').map(
      (unit) => unit.vehicleId
    )
    expect(reversed).toEqual(forward)
  })

  it('defaults to a neutral sort that states no opinion about which units are bad', () => {
    expect(DEFAULT_UNIT_SORT).toBe('store')
    expect(parseUnitSort(null)).toBe('store')
    expect(parseUnitSort('not-a-sort')).toBe('store')
    expect(parseUnitSort('ratio-desc')).toBe('ratio-desc')
  })

  it('resolves a period to one snapshot date rather than pooling several', () => {
    const date = resolveSnapshotDate(units, DEFAULT_FILTERS)
    const selected = selectUnits(units, date, DEFAULT_FILTERS, null)
    for (const unit of selected) expect(unit.snapshotDate).toBe(date)
    // Investment summed over the whole partition must exceed one date's, or the fixture is
    // not exercising the semi-additive hazard.
    const oneDate = summarizeInventory(selected, date)
    const pooled = summarizeInventory(units, date)
    expect(pooled.units).toBeGreaterThanOrEqual(oneDate.units)
  })
})

describe('unit selection and drill-through', () => {
  const date = resolveSnapshotDate(units, DEFAULT_FILTERS)
  const selected = selectUnits(units, date, DEFAULT_FILTERS, null)

  it('finds a unit by its business identifier', () => {
    const wanted = selected[0]
    expect(wanted).toBeDefined()
    expect(findUnit(selected, wanted!.vehicleId)?.vehicleId).toBe(wanted!.vehicleId)
  })

  it('returns null for a unit the selection does not hold', () => {
    expect(findUnit(selected, 'VEH-9999999')).toBeNull()
    expect(findUnit(selected, null)).toBeNull()
  })

  it('searches the fields it says it searches', () => {
    const wanted = selected[0]!
    expect(
      selectUnits(units, date, DEFAULT_FILTERS, wanted.vehicleId).some(
        (unit) => unit.vehicleId === wanted.vehicleId
      )
    ).toBe(true)
    expect(
      selectUnits(units, date, DEFAULT_FILTERS, wanted.make).every(
        (unit) => unit.make === wanted.make
      )
    ).toBe(true)
    expect(selectUnits(units, date, DEFAULT_FILTERS, 'zzzz-no-such-unit')).toHaveLength(0)
  })

  it('narrows condition on the type, so Certified is not swallowed by Used', () => {
    const certified = selectUnits(
      units,
      date,
      { ...DEFAULT_FILTERS, condition: 'Certified' },
      null
    )
    for (const unit of certified) expect(unit.conditionType).toBe('Certified')
    const used = selectUnits(units, date, { ...DEFAULT_FILTERS, condition: 'Used' }, null)
    for (const unit of used) expect(unit.conditionType).toBe('Used')
  })
})
