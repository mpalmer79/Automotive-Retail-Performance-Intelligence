/**
 * The accounting model, reconciled against the export and driven with corrupted fixtures.
 *
 * WHY BOTH HALVES ARE HERE
 * ------------------------
 * `dashboard-boundaries.test.ts` lets `accounting.ts` perform exact arithmetic on the
 * strength of a claim: that it sums published columns and invents no measure. A filename on
 * an allowlist proves nothing, so this file is where that claim is actually tested — first by
 * reconciling what the model produces against the committed export row by row, and then by
 * seeding each mistake the model could plausibly make and requiring a DIFFERENT answer.
 *
 * A seeded-defect test that passes on both the right and the wrong implementation is not a
 * test. Every corruption below is asserted to change the number.
 */
import { describe, expect, it } from 'vitest'

import {
  accountingExceptionRows,
  glReconciliationRows,
} from '../../src/lib/dashboard/accounting-data.ts'
import {
  comparisonDates,
  exceptionDrillThrough,
  resolveComparisonDate,
  selectComparisons,
  summarize,
  toComparisonRows,
  toExceptionRows,
  varianceDirection,
  type ComparisonRow,
} from '../../src/lib/dashboard/accounting.ts'
import { addExact, exactToString, exactZero } from '../../src/lib/dashboard/decimal.ts'
import { DEFAULT_FILTERS } from '../../src/lib/dashboard/filters.ts'

const rows = toComparisonRows(glReconciliationRows())
const exceptions = toExceptionRows(accountingExceptionRows())

describe('the comparison set matches the export', () => {
  it('carries every row the export declares', () => {
    expect(rows.length).toBe(glReconciliationRows().length)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('resolves a state from the closed vocabulary on every row', () => {
    for (const row of rows) {
      expect([
        'Reconciled',
        'Variance',
        'Missing GL balance',
        'Missing subledger balance',
      ]).toContain(row.comparisonState)
    }
  })

  it('never carries a variance where a side is missing, and never a zero in its place', () => {
    for (const row of rows) {
      if (row.comparisonState === 'Missing GL balance') {
        expect(row.glBalance, `${row.dealershipId}/${row.glAccountNumber}`).toBeNull()
        expect(row.varianceAmount).toBeNull()
        expect(row.isComparable).toBe(false)
      }
      if (row.comparisonState === 'Missing subledger balance') {
        expect(row.subledgerBalance).toBeNull()
        expect(row.varianceAmount).toBeNull()
        expect(row.isComparable).toBe(false)
      }
    }
  })

  it('publishes a variance on every comparable row and none elsewhere', () => {
    for (const row of rows) {
      expect(row.varianceAmount !== null).toBe(row.isComparable)
    }
  })
})

describe('the signed variance reconciles to the export', () => {
  const date = resolveComparisonDate(rows, DEFAULT_FILTERS)
  const selected = selectComparisons(rows, date, DEFAULT_FILTERS)
  const summary = summarize(selected, date)

  it('totals the SIGNED variances the export published, not a recomputation', () => {
    let expected = exactZero(2)
    for (const row of selected) {
      if (row.varianceAmount !== null) expected = addExact(expected, row.varianceAmount)
    }
    expect(exactToString(summary.signedVariance)).toBe(exactToString(expected))
  })

  it('counts every position exactly once across the four states', () => {
    const counted =
      summary.reconciledPositions +
      summary.variancePositions +
      summary.missingGlPositions +
      summary.missingSubledgerPositions
    expect(counted).toBe(summary.totalPositions)
    expect(summary.totalPositions).toBe(selected.length)
  })

  it('excludes missing-side positions from both totals', () => {
    expect(summary.comparablePositions).toBe(
      selected.filter((row) => row.isComparable).length
    )
    expect(summary.comparablePositions).toBe(
      summary.totalPositions -
        summary.missingGlPositions -
        summary.missingSubledgerPositions
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Seeded defects                                                              */
/* -------------------------------------------------------------------------- */

/** A synthetic comparison set that exercises all four states and both variance signs. */
function fixture(): ComparisonRow[] {
  const base = {
    dealershipId: 'GSA-001',
    comparisonDate: '2025-12-31',
    glAccountName: 'New Vehicle Inventory',
    controlAccountCategory: 'New Vehicle Inventory',
    stockUnitCount: 10,
    floorplanPrincipal: null,
  }
  const money = (value: string): ReturnType<typeof exactZero> =>
    toComparisonRows([
      {
        dealership_id: 'X',
        comparison_date: '2025-12-31',
        gl_account_number: '0',
        gl_account_name: 'x',
        control_account_category: 'New Vehicle Inventory',
        subledger_balance: value,
        gl_balance: value,
        variance_amount: value,
        comparison_state: 'Reconciled',
        is_reconciled: true,
        is_comparable: true,
        stock_unit_count: 1,
        floorplan_principal: null,
      },
    ])[0]!.varianceAmount!

  return [
    {
      ...base,
      glAccountNumber: '1210',
      subledgerBalance: money('1000.00'),
      glBalance: money('1400.00'),
      varianceAmount: money('400.00'),
      comparisonState: 'Variance',
      isComparable: true,
    },
    {
      ...base,
      glAccountNumber: '1220',
      subledgerBalance: money('2000.00'),
      glBalance: money('1984.60'),
      varianceAmount: money('-15.40'),
      comparisonState: 'Variance',
      isComparable: true,
    },
    {
      ...base,
      glAccountNumber: '1230',
      subledgerBalance: money('500.00'),
      glBalance: null,
      varianceAmount: null,
      comparisonState: 'Missing GL balance',
      isComparable: false,
    },
    {
      ...base,
      glAccountNumber: '1240',
      subledgerBalance: null,
      glBalance: money('700.00'),
      varianceAmount: null,
      comparisonState: 'Missing subledger balance',
      isComparable: false,
    },
  ]
}

describe('seeded defects change the answer', () => {
  const clean = summarize(fixture(), '2025-12-31')

  it('nets opposing variances rather than adding their magnitudes', () => {
    // +400.00 and -15.40 net to 384.60. The absolute sum, 415.40, describes a dealership
    // that does not exist, and is what an implementation using absolute_variance_amount
    // would produce.
    expect(exactToString(clean.signedVariance)).toBe('384.60')

    const absolute = fixture().map((row) =>
      row.varianceAmount === null
        ? row
        : {
            ...row,
            varianceAmount: toComparisonRows([
              {
                dealership_id: 'X',
                comparison_date: '2025-12-31',
                gl_account_number: '0',
                gl_account_name: 'x',
                control_account_category: 'New Vehicle Inventory',
                subledger_balance: null,
                gl_balance: null,
                variance_amount: exactToString(row.varianceAmount).replace('-', ''),
                comparison_state: 'Variance',
                is_reconciled: false,
                is_comparable: true,
                stock_unit_count: 1,
                floorplan_principal: null,
              },
            ])[0]!.varianceAmount,
          }
    )
    const corrupted = summarize(absolute, '2025-12-31')
    expect(exactToString(corrupted.signedVariance)).toBe('415.40')
    expect(exactToString(corrupted.signedVariance)).not.toBe(
      exactToString(clean.signedVariance)
    )
  })

  it('reads a missing side as missing rather than as zero', () => {
    // The clean totals cover the two comparable positions only: 3000.00 and 3384.60.
    expect(exactToString(clean.subledgerTotal)).toBe('3000.00')
    expect(exactToString(clean.glTotal)).toBe('3384.60')

    // Treating the two one-sided rows as comparable — the COALESCE-to-zero mistake — pulls
    // their present balances into the totals and manufactures variances from nothing.
    const zeroed = fixture().map((row) =>
      row.isComparable
        ? row
        : {
            ...row,
            isComparable: true,
            subledgerBalance: row.subledgerBalance ?? exactZero(2),
            glBalance: row.glBalance ?? exactZero(2),
            varianceAmount: exactZero(2),
          }
    )
    const corrupted = summarize(zeroed, '2025-12-31')
    expect(exactToString(corrupted.subledgerTotal)).not.toBe(
      exactToString(clean.subledgerTotal)
    )
    expect(exactToString(corrupted.glTotal)).not.toBe(exactToString(clean.glTotal))
    expect(corrupted.comparablePositions).toBe(4)
    expect(clean.comparablePositions).toBe(2)
  })

  it('counts the missing sides separately instead of folding them into the variance count', () => {
    expect(clean.variancePositions).toBe(2)
    expect(clean.missingGlPositions).toBe(1)
    expect(clean.missingSubledgerPositions).toBe(1)
    // A page that summed these into one "exceptions" figure would report 4, which conflates
    // a controlled variance with a missing balance. They are different findings.
    expect(clean.variancePositions).not.toBe(
      clean.variancePositions + clean.missingGlPositions + clean.missingSubledgerPositions
    )
  })

  it('resolves a period to one date rather than summing balances across dates', () => {
    const dates = comparisonDates(rows)
    expect(dates.length).toBeGreaterThan(1)

    const resolved = resolveComparisonDate(rows, DEFAULT_FILTERS)
    expect(resolved).toBe(dates[0])

    const oneDate = selectComparisons(rows, resolved, DEFAULT_FILTERS)
    for (const row of oneDate) expect(row.comparisonDate).toBe(resolved)

    // Summing every date is the semi-additive mistake. It must not equal the correct answer,
    // or the fixture would not be proving anything.
    let acrossDates = exactZero(2)
    for (const row of rows) {
      if (row.varianceAmount !== null)
        acrossDates = addExact(acrossDates, row.varianceAmount)
    }
    const correct = summarize(oneDate, resolved)
    expect(exactToString(acrossDates)).not.toBe(exactToString(correct.signedVariance))
  })

  it('states the direction in words rather than relying on a sign glyph', () => {
    expect(varianceDirection(clean.signedVariance)).toContain(
      'general ledger carries more'
    )
    const negated = summarize(
      fixture().filter((row) => row.glAccountNumber === '1220'),
      '2025-12-31'
    )
    expect(varianceDirection(negated.signedVariance)).toContain('subledger carries more')
    expect(varianceDirection(exactZero(2))).toContain('agree exactly')
  })
})

describe('exception drill-through', () => {
  it('resolves every exported exception to a real destination', () => {
    expect(exceptions.length).toBeGreaterThan(0)
    for (const row of exceptions) {
      const href = exceptionDrillThrough(row)
      expect(href, row.exceptionId).not.toBeNull()
      expect(href).toMatch(
        /^\/dashboard\/accounting\?store=GSA-\d{3}&period=\d{4}-\d{2}$/
      )
    }
  })

  it('fabricates no link for an entity kind the console has no surface for', () => {
    const unknown = { ...exceptions[0]!, entityName: 'journal_entry' }
    expect(exceptionDrillThrough(unknown)).toBeNull()
  })

  it('carries no warehouse surrogate into the destination', () => {
    for (const row of exceptions) {
      const href = exceptionDrillThrough(row) ?? ''
      // `20250930-1-2` is the shape the view's entity_key uses. No URL may contain one.
      expect(href).not.toMatch(/\d{8}-\d+-\d+/)
    }
  })
})
