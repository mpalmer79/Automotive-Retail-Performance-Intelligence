/**
 * The employee-performance model, reconciled against the export and driven with seeded defects.
 *
 * Same contract as `dashboard-leads-marketing.test.ts`: `dashboard-boundaries.test.ts` permits
 * `employees.ts` to perform exact arithmetic on the strength of a claim, and this is where the
 * claim is tested rather than asserted.
 *
 * EVERY SEEDED DEFECT BELOW MUST CHANGE THE ANSWER. A corruption that produces the same output
 * under the right and the wrong implementation proves nothing, so each one asserts a DIFFERENCE
 * first and only then asserts which of the two is correct. Where the committed data happens not
 * to distinguish two implementations, the test says so and fails rather than passing vacuously.
 *
 * THE FAIRNESS GUARDS ARE ASSERTED AGAINST SOURCE, NOT AGAINST RENDERING. A page that avoids
 * the word "rank" while sorting by gross is still a leaderboard, so the ordering, the absence of
 * a comparator argument and the absence of ranking vocabulary are each checked directly.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { chunkFile } from '../../src/lib/dashboard/chunks.ts'
import { dashboardLeadSources, decodeDataset } from '../../src/lib/dashboard/data.ts'
import { exactToString, type Exact } from '../../src/lib/dashboard/decimal.ts'
import {
  buildEmployeeView,
  buildRoster,
  buildStoreInventory,
  comparative,
  floorFromRows,
  medianResponseSeconds,
  orderEmployees,
  ROLE_DESCRIPTIONS,
  ROLE_FAMILIES,
  ROLE_SLUGS,
  roleFromSlug,
  sample,
  scopeFromFilters,
  sourceMix,
  summarise,
  type EmployeeScope,
} from '../../src/lib/dashboard/employees.ts'
import {
  employeeLeadSourceChunkFile,
  employeeSalesChunkFile,
  employeesChunkKeys,
} from '../../src/lib/dashboard/employees-chunks.ts'
import {
  employeeAppointmentRows,
  employeeFinanceRows,
  employeeLeadSourceRows,
  employeeRosterRows,
  employeeSalesRows,
} from '../../src/lib/dashboard/employees-data.ts'
import { DEFAULT_FILTERS } from '../../src/lib/dashboard/filters.ts'
import { isFigure, type Figure } from '../../src/lib/dashboard/figures.ts'
import type { DashboardRow } from '../../src/types/dashboard.ts'

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const SRC = join(process.cwd(), 'src')
const STORES = ['GSA-001', 'GSA-002', 'GSA-003'] as const
const MONTHS = ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'] as const

function period(months: readonly string[] = MONTHS) {
  const first = months[0] ?? '2025-07'
  const last = months[months.length - 1] ?? '2025-12'
  return {
    start: `${first}-01`,
    end: `${last}-31`,
    label: 'The reporting window',
    months: [...months],
    wholeMonths: [...months],
    calendarDays: 184,
    sellingDays: 160,
  }
}

function scope(overrides: Partial<EmployeeScope> = {}): EmployeeScope {
  return {
    stores: [...STORES],
    period: period(),
    role: 'salesperson',
    family: 'Salesperson',
    employee: null,
    employeeUnknown: false,
    ...overrides,
  }
}

const roster = buildRoster(employeeRosterRows())

function data(months: readonly string[] = MONTHS) {
  return {
    roster,
    sales: employeeSalesRows(STORES, months),
    finance: employeeFinanceRows(),
    appointments: employeeAppointmentRows(),
    leadSource: employeeLeadSourceRows(STORES, months),
  }
}

function build(s: EmployeeScope, months: readonly string[] = MONTHS) {
  return buildEmployeeView(s, data(months), dashboardLeadSources, 0)
}

function value(figure: Figure): string {
  expect(isFigure(figure), `expected a value, got ${figure.kind}`).toBe(true)
  return isFigure(figure) ? exactToString(figure.value) : ''
}

function exact(units: bigint, scale: number): Exact {
  return { units, scale }
}

/** Every `.ts`/`.tsx` file of the employee lane, for the source-level guards. */
function laneSources(): readonly { relative: string; text: string }[] {
  const files: { relative: string; text: string }[] = []
  const targets = [
    'lib/dashboard/employees.ts',
    'lib/dashboard/employees-data.ts',
    'lib/dashboard/employees-chunks.ts',
    'components/dashboard/employees-workspace.tsx',
    'app/(operating)/dashboard/employees/page.tsx',
  ]
  for (const relative of targets) {
    files.push({ relative, text: readFileSync(join(SRC, relative), 'utf8') })
  }
  return files
}

/** Source with block and line comments removed, so prose cannot satisfy or trip a guard. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/* -------------------------------------------------------------------------- */
/* The export is readable and carries what the model needs                     */
/* -------------------------------------------------------------------------- */

describe('the employee export is readable at the route grain', () => {
  it('carries every role family and the unassigned group', () => {
    const families = new Set<string>()
    for (const row of [
      ...employeeSalesRows(STORES, MONTHS),
      ...employeeFinanceRows(),
      ...employeeAppointmentRows(),
      ...employeeLeadSourceRows(STORES, MONTHS),
    ]) {
      families.add(String(row.role_family))
    }
    for (const family of ROLE_FAMILIES) expect(families).toContain(family)
    expect(
      families,
      'activity credited to nobody must survive into the export, not be tidied away'
    ).toContain('Unassigned')
  })

  it('publishes no personal, pay, rank or target column on any employee row', () => {
    const forbidden = [
      'first_name',
      'last_name',
      'full_name',
      'employee_name',
      'email',
      'phone',
      'address',
      'hire_date',
      'termination_date',
      'birth',
      'salary',
      'commission',
      'compensation',
      'bonus',
      'pay_plan',
      'gender',
      'race',
      'ethnicity',
      'religion',
      'marital',
      'veteran',
      'rank',
      'score',
      'percentile',
      'quartile',
      'tier',
      'target',
      'quota',
      'attainment',
    ]
    const rows = [
      ...employeeRosterRows(),
      ...employeeSalesRows(STORES, MONTHS),
      ...employeeFinanceRows(),
      ...employeeAppointmentRows(),
      ...employeeLeadSourceRows(STORES, MONTHS),
    ]
    const columns = new Set<string>()
    for (const row of rows)
      for (const key of Object.keys(row)) columns.add(key.toLowerCase())
    for (const column of columns) {
      expect(
        forbidden.some((token) => column.includes(token)),
        `the employee export publishes ${column}`
      ).toBe(false)
    }
  })

  it('reads the sample floor from the export and never from a constant', () => {
    const floor = floorFromRows(employeeSalesRows(STORES, MONTHS), -1)
    expect(floor).toBeGreaterThan(0)

    // DEFECT 14: THE FLOOR HARD-CODED INSTEAD OF READ FROM THE AUTHORITY.
    // Asserted against the source, because a literal that happened to equal the export's
    // value today would pass every behavioural test and drift the moment the function moved.
    for (const file of laneSources()) {
      const code = stripComments(file.text)
      expect(
        /minimum[_ ]?sample[_ ]?floor\s*[=:]\s*\d/i.test(code),
        `${file.relative} assigns a literal minimum sample floor`
      ).toBe(false)
      expect(
        /\bfloor\s*[=:]\s*10\b/.test(code),
        `${file.relative} hard-codes the floor as 10`
      ).toBe(false)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Sample discipline                                                           */
/* -------------------------------------------------------------------------- */

describe('the minimum sample governs each measure by its own denominator', () => {
  it('suppresses the ratio below the floor and still publishes the count', () => {
    const below = comparative(
      exact(9000n, 2),
      exact(6n, 0),
      sample(exact(6n, 0), 10),
      2,
      'units'
    )
    expect(isFigure(below)).toBe(false)
    expect(below.kind).toBe('insufficient-sample')

    // DEFECT 48: THE DENOMINATOR THAT CAUSED THE SUPPRESSION MUST STAY VISIBLE.
    if (below.kind !== 'value') {
      expect(below.reason).toContain('6')
      expect(below.reason).toContain('10')
    }
  })

  it('distinguishes a below-floor sample from no sample at all', () => {
    // DEFECT 49: FOUR ABSENCES COLLAPSED INTO ONE. Zero observations is NOT a small sample:
    // saying "insufficient sample" over an empty denominator tells a reader someone fell
    // short of a threshold when in fact they had no opportunity.
    const none = comparative(
      exact(0n, 2),
      exact(0n, 0),
      sample(exact(0n, 0), 10),
      2,
      'units'
    )
    expect(none.kind).toBe('no-data')
    const small = comparative(
      exact(1n, 2),
      exact(1n, 0),
      sample(exact(1n, 0), 10),
      2,
      'units'
    )
    expect(small.kind).toBe('insufficient-sample')
    expect(none.kind).not.toBe(small.kind)
  })

  it('never renders a below-floor metric as zero, and never as a number', () => {
    // DEFECTS 15 and 16: A below-floor figure that printed its value, or printed $0 / 0%,
    // would both be false statements — the first about the person, the second about the data.
    const below = comparative(
      exact(120000n, 2),
      exact(4n, 0),
      sample(exact(4n, 0), 10),
      2,
      'retail units'
    )
    expect(isFigure(below)).toBe(false)
    expect(Object.keys(below)).not.toContain('value')
  })

  it('applies each governed denominator to its own measure and not a shared row count', () => {
    // DEFECT 46: ONE NAIVE SAMPLE COUNT APPLIED TO EVERYTHING. On the BDC surface the four
    // ratios have four different denominators, and they must not all be the same number.
    const view = build(scope({ role: 'bdc', family: 'BDC' }))
    expect(view.rows.length).toBeGreaterThan(0)
    const row = view.rows[0]
    expect(row).toBeDefined()
    if (row === undefined) return
    const denominators = row.measures.map((measure) => measure.sample?.denominator)
    expect(denominators).toHaveLength(4)
    expect(
      new Set(denominators).size,
      'four ratios sharing one denominator is the defect this guards'
    ).toBeGreaterThan(1)

    const labels = row.measures.map((measure) => measure.sampleLabel)
    expect(labels).toEqual([
      'valid leads',
      'contacted leads',
      'eligible appointments',
      'shown appointments',
    ])
  })

  it('finds a real below-floor employee in the committed export', () => {
    // THE BACKLOG REQUIRES A BELOW-FLOOR STATE FROM REAL DATA, not a manufactured one. This
    // is the scope the browser test uses, asserted here so a data change that removed it
    // fails in the fast suite rather than in Playwright.
    const view = build(scope(), ['2025-12'])
    const suppressed = view.rows.filter((row) =>
      row.measures.some((measure) => measure.figure.kind === 'insufficient-sample')
    )
    expect(
      suppressed.length,
      'no salesperson falls below the floor in December — the committed evidence for the ' +
        'insufficient-sample state has gone, and the browser test that renders it is now vacuous'
    ).toBeGreaterThan(0)
    const eligible = view.rows.filter((row) =>
      row.measures.some((measure) => isFigure(measure.figure))
    )
    expect(
      eligible.length,
      'every salesperson is below the floor, so the test cannot tell suppression from a bug'
    ).toBeGreaterThan(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Arithmetic                                                                  */
/* -------------------------------------------------------------------------- */

describe('every ratio is a ratio of sums', () => {
  it('computes gross per retail unit as SUM over SUM, not as an average of ratios', () => {
    // DEFECT 3: PVR AS THE AVERAGE OF SUBGROUP PVRs. The two answers differ whenever the
    // subgroups have different unit counts, which they do here — so the test asserts the
    // DIFFERENCE first, then which of the two the model produced.
    const view = build(scope())
    const rows = employeeSalesRows(STORES, MONTHS).filter(
      (row) => row.role_family === 'Salesperson'
    )
    const byEmployee = new Map<string, DashboardRow[]>()
    for (const row of rows) {
      const code = String(row.employee_code)
      byEmployee.set(code, [...(byEmployee.get(code) ?? []), row])
    }

    const target = view.rows.find((row) =>
      isFigure(row.measures[1]?.figure ?? { kind: 'no-data', reason: '' })
    )
    expect(target).toBeDefined()
    if (target === undefined) return

    const employeeRows = byEmployee.get(target.code) ?? []
    let gross = 0
    let units = 0
    let averageOfDaily = 0
    let days = 0
    for (const row of employeeRows) {
      const g = Number(row.sold_total_gross)
      const u = Number(row.sold_retail_units)
      gross += g
      units += u
      if (u > 0) {
        averageOfDaily += g / u
        days += 1
      }
    }
    const ratioOfSums = gross / units
    const averageOfRatios = averageOfDaily / days
    expect(
      Math.abs(ratioOfSums - averageOfRatios),
      'the committed data does not distinguish the two implementations, so this test proves nothing'
    ).toBeGreaterThan(0.5)

    const rendered = Number(
      value(target.measures[1]?.figure ?? { kind: 'no-data', reason: '' })
    )
    expect(Math.abs(rendered - ratioOfSums)).toBeLessThan(0.01)
    expect(Math.abs(rendered - averageOfRatios)).toBeGreaterThan(0.5)
  })

  it('keeps wholesale and dealer-trade units out of the retail denominator', () => {
    // DEFECT 4. The export publishes the excluded population, so the exclusion is checkable
    // rather than trusted: a model that used every unit would produce a different sample.
    const rows = employeeSalesRows(STORES, MONTHS).filter(
      (row) => row.role_family === 'Salesperson'
    )
    const nonRetail = rows.reduce(
      (sum, row) => sum + Number(row.sold_non_retail_units),
      0
    )
    expect(
      nonRetail,
      'no non-retail unit is credited to a salesperson in this export, so the exclusion is untested'
    ).toBeGreaterThan(0)

    const view = build(scope())
    const totalRetail = view.rows.reduce((sum, row) => sum + row.volume, 0)
    const allUnits = rows.reduce(
      (sum, row) =>
        sum + Number(row.sold_retail_units) + Number(row.sold_non_retail_units),
      0
    )
    expect(totalRetail).toBeLessThan(allUnits)
    expect(totalRetail + nonRetail).toBe(allUnits)
  })

  it('keeps certified units inside used and never as a third category', () => {
    // DEFECT 5 and its mirror: certified excluded from used, or added to it.
    const view = build(scope())
    const rows = employeeSalesRows(STORES, MONTHS).filter(
      (row) => row.role_family === 'Salesperson'
    )
    const certified = rows.reduce((sum, row) => sum + Number(row.sold_certified_units), 0)
    expect(
      certified,
      'no certified unit in the export, so this test proves nothing'
    ).toBeGreaterThan(0)

    for (const employee of view.rows) {
      const mix = employee.mix
      const total = mix.reduce((sum, slice) => sum + slice.count, 0)
      expect(
        total,
        `${employee.code}: new + used must equal retail units exactly, with certified inside used`
      ).toBe(employee.volume)
      expect(mix.map((slice) => slice.label)).toEqual(['New', 'Used'])
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Funnel denominators                                                         */
/* -------------------------------------------------------------------------- */

describe('the BDC funnel uses its governed denominators', () => {
  it('divides appointment-set leads by CONTACTED leads, never by all valid leads', () => {
    // DEFECT 7, and the one this project has already shipped once. The two denominators
    // differ materially here, so the wrong one produces a visibly different rate.
    const view = build(scope({ role: 'bdc', family: 'BDC' }))
    const row = view.rows[0]
    expect(row).toBeDefined()
    if (row === undefined) return

    const validSample = row.measures[0]?.sample?.denominator ?? 0
    const contactedSample = row.measures[1]?.sample?.denominator ?? 0
    expect(contactedSample).toBeLessThan(validSample)
    expect(contactedSample).toBeGreaterThan(0)

    const leadRows = employeeLeadSourceRows(STORES, MONTHS).filter(
      (r) => r.employee_code === row.code
    )
    const apptSet = leadRows.reduce((s, r) => s + Number(r.appointment_set_lead_count), 0)
    const correct = apptSet / contactedSample
    const wrong = apptSet / validSample
    expect(Math.abs(correct - wrong)).toBeGreaterThan(0.01)

    const rendered = Number(
      value(row.measures[1]?.figure ?? { kind: 'no-data', reason: '' })
    )
    expect(Math.abs(rendered - correct)).toBeLessThan(0.0001)
    expect(Math.abs(rendered - wrong)).toBeGreaterThan(0.01)
  })

  it('excludes advance cancellations from the show-rate denominator and publishes them', () => {
    // DEFECT 8. The eligible count is the denominator; the cancelled count is published on the
    // row because the exclusion that makes show rate correct is the one a store can game.
    const view = build(scope({ role: 'bdc', family: 'BDC' }))
    const row = view.rows[0]
    expect(row).toBeDefined()
    if (row === undefined) return

    const apptRows = employeeAppointmentRows().filter((r) => r.employee_code === row.code)
    const scheduled = apptRows.reduce(
      (s, r) => s + Number(r.bdc_scheduled_appointments),
      0
    )
    const eligible = apptRows.reduce((s, r) => s + Number(r.bdc_eligible_appointments), 0)
    const cancelled = apptRows.reduce(
      (s, r) => s + Number(r.bdc_cancelled_in_advance_appointments),
      0
    )
    expect(
      cancelled,
      'no advance cancellation in the export, so this test proves nothing'
    ).toBeGreaterThan(0)
    expect(eligible).toBe(scheduled - cancelled)
    expect(row.measures[2]?.sample?.denominator).toBe(eligible)

    const cancelledContext = row.context.find(
      (item) => item.label === 'Cancelled in advance'
    )
    expect(cancelledContext?.value).toBe(String(cancelled))
  })

  it('takes show-to-sale from the show-date population, not the scheduled-date one', () => {
    // DEFECT 9. Shown appointments appear twice in the export precisely because they are two
    // populations; using the scheduled-basis column as the conversion denominator is the defect.
    const view = build(scope({ role: 'bdc', family: 'BDC' }))
    const row = view.rows[0]
    expect(row).toBeDefined()
    if (row === undefined) return

    const apptRows = employeeAppointmentRows().filter((r) => r.employee_code === row.code)
    const showBasis = apptRows.reduce(
      (s, r) => s + Number(r.bdc_shown_appointments_show_basis),
      0
    )
    expect(row.measures[3]?.sample?.denominator).toBe(showBasis)
    expect(row.measures[3]?.sampleLabel).toBe('shown appointments')
  })

  it('excludes duplicate leads from every funnel denominator', () => {
    // DEFECT 6. The exclusion is structural in SQL; this asserts the model inherited it
    // rather than re-deriving one side of a ratio from the wrong column.
    const leadRows = employeeLeadSourceRows(STORES, MONTHS)
    const duplicates = leadRows.reduce((s, r) => s + Number(r.duplicate_lead_count), 0)
    expect(
      duplicates,
      'no duplicate lead in the export, so this test proves nothing'
    ).toBeGreaterThan(0)

    const view = build(scope({ role: 'bdc', family: 'BDC' }))
    for (const row of view.rows) {
      const own = leadRows.filter((r) => r.employee_code === row.code)
      const valid = own.reduce((s, r) => s + Number(r.valid_lead_count), 0)
      const all = own.reduce((s, r) => s + Number(r.lead_count), 0)
      expect(row.volume).toBe(valid)
      if (all > valid) expect(row.volume).toBeLessThan(all)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Response time                                                               */
/* -------------------------------------------------------------------------- */

describe('the response median is a true median over the exported population', () => {
  it('excludes the never-responded bin rather than treating it as zero seconds', () => {
    // DEFECT 10. Coalescing null to zero sorts ignored leads to the fastest end and improves
    // the median, which is exactly the flattering error this shape exists to prevent.
    const rows = employeeLeadSourceRows(STORES, MONTHS).filter(
      (row) => row.role_family === 'BDC'
    )
    const unresponded = rows.filter((row) => row.first_response_seconds === null)
    expect(
      unresponded.length,
      'no never-responded bin, so this test proves nothing'
    ).toBeGreaterThan(0)

    const correct = medianResponseSeconds(rows)
    expect(correct).not.toBeNull()

    const coalesced = medianResponseSeconds(
      rows.map((row): DashboardRow =>
        row.first_response_seconds === null
          ? {
              ...row,
              first_response_seconds: 0,
              responded_lead_count: row.unresponded_lead_count ?? 0,
            }
          : row
      )
    )
    expect(coalesced).not.toBeNull()
    if (correct === null || coalesced === null) return
    expect(
      Number(coalesced.units),
      'coalescing the never-responded bin to zero must move the median'
    ).toBeLessThan(Number(correct.units))
  })

  it('is not the average of subgroup medians', () => {
    // DEFECT 11. A median does not decompose. Averaging the per-store medians produces a
    // different number, and the model must not produce that one.
    const rows = employeeLeadSourceRows(STORES, MONTHS).filter(
      (row) => row.role_family === 'BDC'
    )
    const overall = medianResponseSeconds(rows)
    expect(overall).not.toBeNull()
    if (overall === null) return

    const perStore = STORES.map((store) =>
      medianResponseSeconds(rows.filter((row) => row.dealership_id === store))
    ).filter((v): v is Exact => v !== null)
    expect(perStore.length).toBeGreaterThan(1)
    const averaged =
      perStore.reduce((sum, v) => sum + Number(v.units), 0) / perStore.length
    expect(
      Math.abs(averaged - Number(overall.units)),
      'the committed data does not distinguish the two, so this test proves nothing'
    ).toBeGreaterThan(0)
  })

  it('keeps the never-responded count visible beside the median', () => {
    const view = build(scope({ role: 'bdc', family: 'BDC' }))
    for (const row of view.rows) {
      const labels = row.context.map((item) => item.label)
      expect(labels).toContain('Never responded')
      expect(labels).toContain('Median response')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Finance                                                                     */
/* -------------------------------------------------------------------------- */

describe('the finance surface keeps its governed denominator and its structure mix', () => {
  it('keeps cash deals inside the PVR denominator', () => {
    // DEFECT 12. Reserve PVR divides by ALL retail units. Dropping cash deals from the
    // denominator inflates it, and the structure mix is what makes the caution checkable.
    const view = build(scope({ role: 'finance', family: 'Finance' }))
    const row = view.rows[0]
    expect(row).toBeDefined()
    if (row === undefined) return

    const own = employeeFinanceRows().filter((r) => r.employee_code === row.code)
    const units = own.reduce((s, r) => s + Number(r.financed_retail_units), 0)
    const cash = own.reduce((s, r) => s + Number(r.financed_cash_deals), 0)
    expect(
      cash,
      'no cash deal for this manager, so this test proves nothing'
    ).toBeGreaterThan(0)
    expect(row.measures[1]?.sample?.denominator).toBe(units)
    expect(row.measures[1]?.sample?.denominator).not.toBe(units - cash)
  })

  it('publishes the structure mix as a partition beside every finance figure', () => {
    const view = build(scope({ role: 'finance', family: 'Finance' }))
    for (const row of view.rows) {
      expect(row.mixLabel).toBe('Finance structure')
      expect(row.mix.map((slice) => slice.label)).toEqual([
        'Cash',
        'Retail finance',
        'Lease',
      ])
      expect(row.mix.reduce((sum, slice) => sum + slice.count, 0)).toBe(row.volume)
    }
  })

  it('does not present contract rows as a penetration figure', () => {
    // DEFECT 13. Penetration has a per-category eligible-deal denominator this page does not
    // carry, so no measure here may be labelled one.
    const view = build(scope({ role: 'finance', family: 'Finance' }))
    for (const row of view.rows) {
      for (const measure of row.measures) {
        expect(measure.label.toLowerCase()).not.toContain('penetration')
      }
      for (const item of row.context) {
        expect(item.label.toLowerCase()).not.toContain('penetration')
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The non-ranking contract                                                    */
/* -------------------------------------------------------------------------- */

describe('nothing on this route ranks anybody', () => {
  it('orders the comparison by store, role and code, and by nothing else', () => {
    // DEFECTS 18 and 19. Sorting by units or gross is a leaderboard whether or not it is
    // labelled one, so the ordering is asserted against a shuffled input.
    const view = build(scope())
    const ordered = orderEmployees([...view.rows].reverse())
    const keys = ordered.map((row) => `${row.storeId}|${row.jobRole}|${row.code}`)
    expect(keys).toEqual([...keys].sort())

    const volumes = ordered.map((row) => row.volume)
    const descending = [...volumes].sort((a, b) => b - a)
    expect(
      volumes,
      'the list happens to be in descending volume order, so this test cannot tell the two apart'
    ).not.toEqual(descending)
  })

  it('exposes no sort control and no comparator argument', () => {
    // A comparator parameter would put a leaderboard one call away, so the signature is the
    // guard rather than a convention.
    expect(orderEmployees.length).toBe(1)
    for (const file of laneSources()) {
      const code = stripComments(file.text)
      expect(
        /sortBy|sort=|orderBy|\bsortKey\b/i.test(code),
        `${file.relative} offers a sort control`
      ).toBe(false)
    }
  })

  it('uses no ranking vocabulary in anything it renders as a label', () => {
    // DEFECT 20, split into the two guards the distinction actually needs.
    //
    // A RAW SOURCE SCAN CANNOT TELL AN ASSERTION FROM A DISCLAIMER. The page says, in visible
    // copy, that "a list sorted by gross is a leaderboard whether or not it is labelled one" —
    // which is the contract being stated, not broken — and a guard that banned the word would
    // push the page toward explaining itself less. So the full vocabulary is checked against
    // every string the model actually produces as a LABEL, where a disclaimer cannot occur.
    const banned = [
      'top performer',
      'bottom performer',
      'best',
      'worst',
      'star',
      'underperform',
      'outperform',
      'leaderboard',
      'rank',
      'percentile',
      'quartile',
      'tier',
      'score',
      'quality',
      'difficulty',
      'trophy',
      'medal',
      'podium',
      'winner',
      'streak',
    ]
    const labels: string[] = [...Object.values(ROLE_DESCRIPTIONS)]
    for (const slug of Object.keys(ROLE_SLUGS)) {
      const family = ROLE_SLUGS[slug as keyof typeof ROLE_SLUGS]
      const view = build(scope({ role: slug as never, family }))
      labels.push(...view.unassigned.map((entry) => entry.label))
      labels.push(...view.unassigned.map((entry) => entry.note))
      for (const row of view.rows) {
        labels.push(row.volumeLabel)
        if (row.mixLabel !== null) labels.push(row.mixLabel)
        labels.push(...row.measures.map((measure) => measure.label))
        labels.push(...row.measures.map((measure) => measure.sampleLabel ?? ''))
        labels.push(...row.mix.map((slice) => slice.label))
        labels.push(...row.context.map((item) => item.label))
      }
    }
    expect(labels.length).toBeGreaterThan(50)
    for (const label of labels) {
      const lowered = label.toLowerCase()
      for (const phrase of banned) {
        expect(
          lowered.includes(phrase),
          `a rendered label says "${phrase}": ${label}`
        ).toBe(false)
      }
    }
  })

  it('carries no gamification vocabulary in any executable source', () => {
    // The narrow half: an icon, class name, asset path or string literal naming any of these
    // is a defect. Checked against COMMENT-STRIPPED source, because `employees-workspace.tsx`
    // states the ban in its own header — "no podium, medal, trophy, crown, star, badge,
    // streak or flame" — and that sentence is the contract, not a breach of it. This is the
    // same distinction the label guard above draws.
    const banned = [
      'trophy',
      'medal',
      'crown',
      'podium',
      'streak',
      'composite score',
      'performance score',
      'productivity score',
      'efficiency score',
      'coaching score',
      'risk score',
    ]
    for (const file of laneSources()) {
      const lowered = stripComments(file.text).toLowerCase()
      for (const phrase of banned) {
        expect(lowered.includes(phrase), `${file.relative} contains "${phrase}"`).toBe(
          false
        )
      }
    }
  })

  it('produces no composite figure and no employee target', () => {
    // DEFECT 32. Employee-scope targets are deliberately unpopulated, and nothing here may
    // invent one.
    const view = build(scope())
    for (const row of view.rows) {
      const labels = [
        ...row.measures.map((m) => m.label),
        ...row.context.map((c) => c.label),
      ]
      for (const label of labels) {
        const lowered = label.toLowerCase()
        expect(lowered).not.toContain('score')
        expect(lowered).not.toContain('rank')
        expect(lowered).not.toContain('target')
        expect(lowered).not.toContain('quota')
        expect(lowered).not.toContain('goal')
        expect(lowered).not.toContain('pace')
      }
    }
  })

  it('applies no good/bad colour to any employee outcome', () => {
    // DEFECT 31. The only non-neutral treatment is the publication state, which is also
    // spelled out in words, so colour is never the sole carrier of meaning.
    const component = stripComments(
      readFileSync(join(SRC, 'components/dashboard/employees-workspace.tsx'), 'utf8')
    )
    expect(component).not.toContain('data-positive')
    expect(component).not.toContain('data-negative')
    expect(component).not.toMatch(/\btext-(green|red|emerald|rose)\b/)
    expect(component).not.toMatch(/\bbg-(green|red|emerald|rose)\b/)
    // The attention treatment is permitted, and only for the suppression state.
    expect(component).toContain('text-data-warning')
    expect(component).toContain('Insufficient sample')
  })

  it('makes no causal claim about a person', () => {
    const view = build(scope())
    const banned = ['caused', 'drove', 'created', 'lost because', 'rescued', 'failed']
    for (const row of view.rows) {
      for (const item of [
        ...row.measures.map((m) => m.label),
        ...row.context.map((c) => c.label),
      ]) {
        for (const word of banned) expect(item.toLowerCase()).not.toContain(word)
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Store context and unassigned activity                                       */
/* -------------------------------------------------------------------------- */

describe('store context is a store figure and unassigned activity survives', () => {
  it('never puts store inventory on an employee row', () => {
    // DEFECT 28. A repeated store figure on employee rows is a figure something eventually
    // sums across people and publishes as group inventory. It cannot be summed here because
    // no employee row carries it.
    const view = build(scope())
    for (const row of view.rows) {
      const labels = [
        ...row.measures.map((m) => m.label),
        ...row.context.map((c) => c.label),
      ]
      for (const label of labels) {
        expect(label.toLowerCase()).not.toContain('inventory')
      }
    }
  })

  it('computes store inventory once per store, as an average over observed days', () => {
    const rows: DashboardRow[] = []
    for (const store of STORES) {
      for (const month of MONTHS) {
        const file = chunkFile('inventory-health', store, month)
        if (file === undefined) continue
        rows.push(...decodeDataset(`inventory-health/${store}/${month}`, file))
      }
    }
    const context = buildStoreInventory(rows, scope())
    expect(context).toHaveLength(STORES.length)
    for (const store of context) {
      expect(store.observedDays).toBeGreaterThan(1)
      expect(isFigure(store.averageActiveUnits)).toBe(true)
      // A SUM WOULD BE ROUGHLY `observedDays` TIMES LARGER AND ENTIRELY PLAUSIBLE.
      const total = rows
        .filter((row) => row.dealership_id === store.storeId)
        .reduce((sum, row) => sum + Number(row.active_inventory_units), 0)
      const average = Number(value(store.averageActiveUnits))
      expect(average).toBeLessThan(total / 2)
    }
  })

  it('keeps activity credited to nobody visible', () => {
    // DEFECT 25. The tempting defect is an inner join that makes employee totals look clean.
    const finance = build(scope({ role: 'finance', family: 'Finance' }))
    expect(finance.unassigned.length).toBeGreaterThan(0)
    expect(finance.unassigned[0]?.count).toBeGreaterThan(0)

    const bdc = build(scope({ role: 'bdc', family: 'BDC' }))
    expect(bdc.unassigned.length).toBeGreaterThan(0)

    // AND IT IS NEVER GIVEN AN INVENTED EMPLOYEE CODE.
    for (const row of [...finance.rows, ...bdc.rows]) {
      expect(row.code).not.toBe('EMP-00000')
      expect(row.code).toMatch(/^EMP-\d{5}$/)
    }
  })

  it('excludes the unassigned group from the employee comparison', () => {
    for (const slug of Object.keys(ROLE_SLUGS)) {
      const family = ROLE_SLUGS[slug as keyof typeof ROLE_SLUGS]
      const view = build(scope({ role: slug as never, family }))
      for (const row of view.rows) expect(row.family).toBe(family)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Source mix                                                                  */
/* -------------------------------------------------------------------------- */

describe('lead-source mix is context and cannot fan anything out', () => {
  it('sums to the employee lead population and repeats no unit or gross', () => {
    // DEFECT 27. The mix is a finer grain; joining it to the employee row must not multiply
    // units, gross or appointments — and it structurally cannot, because it carries none.
    const leadRows = employeeLeadSourceRows(STORES, MONTHS)
    for (const row of leadRows) {
      expect(row.sold_retail_units).toBeUndefined()
      expect(row.sold_total_gross).toBeUndefined()
      expect(row.bdc_eligible_appointments).toBeUndefined()
    }

    const view = build(scope({ role: 'bdc', family: 'BDC' }))
    const sources = new Map(dashboardLeadSources.map((source) => [source.code, source]))
    for (const row of view.rows) {
      const own = leadRows.filter((r) => r.employee_code === row.code)
      const valid = own.reduce((s, r) => s + Number(r.valid_lead_count), 0)
      const mix = sourceMix(own, sources, exact(BigInt(valid), 0))
      expect(mix.reduce((sum, slice) => sum + slice.count, 0)).toBe(valid)
    }
  })

  it('orders the mix by name and never by size', () => {
    // Ordering a mix by volume makes the biggest source read as the best one.
    const view = build(scope({ role: 'bdc', family: 'BDC' }))
    const row = view.rows[0]
    expect(row).toBeDefined()
    if (row === undefined) return
    const labels = row.mix.map((slice) => slice.label)
    expect(labels).toEqual([...labels].sort())
    expect(labels.length).toBeGreaterThan(1)
  })

  it('never calls the mix a quality or difficulty measure', () => {
    // DEFECT 29 and its neighbours: no lead-quality score, difficulty index or weighting.
    for (const file of laneSources()) {
      const code = stripComments(file.text).toLowerCase()
      // The bans are on the ASSERTION, not on the word. Both this page and its components
      // tell the reader in as many words that there is no lead-quality ranking and that
      // inventory context is availability "and not difficulty"; a guard that forbade the
      // disclaimer would push the page toward saying less. The rendered labels are where the
      // full vocabulary is checked — see the ranking-vocabulary test above.
      expect(code).not.toContain('quality score')
      expect(code).not.toContain('difficulty score')
      expect(code).not.toContain('easy inventory')
      expect(code).not.toContain('hard inventory')
      expect(code).not.toContain('good inventory')
      expect(code).not.toContain('bad inventory')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Route mechanics                                                             */
/* -------------------------------------------------------------------------- */

describe('the route state is addressable and the partitions cannot collide', () => {
  it('resolves every role slug and falls back rather than erroring', () => {
    expect(roleFromSlug('bdc')).toBe('bdc')
    expect(roleFromSlug('BDC')).toBe('bdc')
    expect(roleFromSlug(' finance ')).toBe('finance')
    expect(roleFromSlug('nonsense')).toBe('salesperson')
    expect(roleFromSlug(undefined)).toBe('salesperson')
    expect(roleFromSlug(null)).toBe('salesperson')
  })

  it('reports an unknown employee code rather than rendering an empty page', () => {
    // A well-formed code the export does not contain must not silently produce "no activity",
    // which would be a false statement about a person who does not exist.
    const unknown = scopeFromFilters(
      { ...DEFAULT_FILTERS, employee: 'EMP-99999' },
      period(),
      [...STORES],
      'salesperson',
      roster.map((entry) => entry.code)
    )
    expect(unknown.employeeUnknown).toBe(true)
    expect(unknown.employee).toBeNull()

    const known = scopeFromFilters(
      { ...DEFAULT_FILTERS, employee: roster[0]?.code ?? null },
      period(),
      [...STORES],
      'salesperson',
      roster.map((entry) => entry.code)
    )
    expect(known.employeeUnknown).toBe(false)
  })

  it('decodes each partition under a key that names it', () => {
    // DEFECT 87, and a defect this project has shipped twice. Every partition has the same
    // columns and the same shape, so a shared key returns the first partition for every store
    // and month and the page looks entirely reasonable while being wrong.
    const first = employeeSalesChunkFile('GSA-001', '2025-07')
    const second = employeeSalesChunkFile('GSA-002', '2025-07')
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (first === undefined || second === undefined) return

    decodeDataset('employee-sales/GSA-001/2025-07', first)
    expect(() => decodeDataset('employee-sales/GSA-001/2025-07', second)).toThrow()

    const lead = employeeLeadSourceChunkFile('GSA-001', '2025-08')
    expect(lead).toBeDefined()
    if (lead === undefined) return
    decodeDataset('employee-lead-source/GSA-001/2025-08', lead)
    expect(() => decodeDataset('employee-lead-source/GSA-001/2025-08', first)).toThrow()
  })

  it('carries a distinct partition table per dataset', () => {
    const keys = employeesChunkKeys()
    expect(Object.keys(keys).sort()).toEqual(['employee-lead-source', 'employee-sales'])
    for (const table of Object.values(keys)) expect(table).toHaveLength(18)
  })

  it('has one route directory and no client island', () => {
    const dir = join(SRC, 'app/(operating)/dashboard/employees')
    expect(readdirSync(dir)).toEqual(['page.tsx'])
    for (const file of laneSources()) {
      // Stripped, because `employees-chunks.ts` names the directive in a comment explaining
      // why a client module must never import it.
      expect(
        stripComments(file.text).includes("'use client'"),
        `${file.relative} is a client island`
      ).toBe(false)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

describe('the role summary counts eligibility rather than performance', () => {
  it('reports how many people clear the leading measure and how many do not', () => {
    const view = build(scope())
    const summary = summarise(view)
    expect(summary.people).toBe(view.rows.length)
    expect(summary.eligible + summary.belowFloor).toBeLessThanOrEqual(summary.people)
    expect(summary.floor).toBe(view.floor)
    expect(summary.volume).toBe(view.rows.reduce((sum, row) => sum + row.volume, 0))
  })

  it('publishes the same floor the export carries', () => {
    const view = build(scope())
    const fromExport = floorFromRows(employeeSalesRows(STORES, MONTHS), -1)
    expect(view.floor).toBe(fromExport)
  })
})
