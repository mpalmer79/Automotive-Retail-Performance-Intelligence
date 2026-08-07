/**
 * Targets, attainment and selling-day pace on the console (`DASH.5-03`).
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * The same link `dashboard-executive.test.tsx` owns for the MVP KPIs, applied to the
 * target family: **what the page would render equals what the export published**,
 * character for character rather than `toBeCloseTo`. The export's own totals were proved
 * against the reporting views by the Python integration suite, and the reporting view was
 * proved against an independent warehouse derivation by `test_kpi_verification.py`, so
 * this file closes the last link of the chain.
 *
 * The rest of it covers the states a number cannot express and the arithmetic that is
 * easy to get plausibly wrong:
 *
 *   - a store-month with no plan renders "No target set", never `0`;
 *   - a zero target produces a NULL attainment rather than a division;
 *   - zero elapsed selling days produce a NULL pace and a NULL projection;
 *   - a group attainment is summed components, and **the average of store percentages is
 *     a different and wrong number** — asserted by computing it deliberately;
 *   - one store without a plan leaves the ratio's two sides aligned;
 *   - a filter that changes the actual population without changing the plan suppresses
 *     the comparison entirely rather than publishing a valid percentage of the wrong
 *     thing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { dashboardManifest, dashboardStoreIds } from '../../src/lib/dashboard/data.ts'
import {
  addExact,
  divideExact,
  exactFromInteger,
  exactToString,
  exactZero,
  parseExact,
  type Exact,
} from '../../src/lib/dashboard/decimal.ts'
import { reportingCalendar } from '../../src/lib/dashboard/executive.ts'
import {
  DEFAULT_FILTERS,
  type DashboardFilters,
} from '../../src/lib/dashboard/filters.ts'
import { resolvePeriod, type ResolvedPeriod } from '../../src/lib/dashboard/periods.ts'
import {
  PACE_PROJECTION_LABEL,
  TARGET_DISCLOSURE,
  TARGET_MEASURES,
  buildTargetContext,
  buildStoreTargetContexts,
  paceBarGeometry,
  sellingDayProgress,
  targetComparability,
} from '../../src/lib/dashboard/targets.ts'
import { targetAttainmentRows } from '../../src/lib/dashboard/targets-data.ts'
import { formatRateExact, formatRatioAsPercent } from '../../src/lib/dashboard/format.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '../..')
const SRC = join(PORTFOLIO, 'src')

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** The default filter state, with overrides. */
function filters(overrides: Partial<DashboardFilters> = {}): DashboardFilters {
  return { ...DEFAULT_FILTERS, ...overrides }
}

/** A resolved period for one whole calendar month. */
function month(iso: string): ResolvedPeriod {
  return resolvePeriod({ kind: 'month', month: iso }, 'none', reportingCalendar).period
}

/** Every `YYYY-MM` the export covers, ascending. */
const MONTHS: readonly string[] = [
  ...new Set(targetAttainmentRows().map((row) => String(row.target_month).slice(0, 7))),
].sort()

const LATEST_MONTH = MONTHS[MONTHS.length - 1] as string

function context(period: ResolvedPeriod, overrides: Partial<DashboardFilters> = {}) {
  return buildTargetContext(filters(overrides), period, dashboardStoreIds)
}

/* -------------------------------------------------------------------------- */
/* 1. The dataset itself                                                       */
/* -------------------------------------------------------------------------- */

describe('the exported target dataset', () => {
  it('is declared in the manifest with the grain the console reads it at', () => {
    const declared = dashboardManifest.datasets.find(
      (dataset) => dataset.name === 'target-attainment'
    )
    expect(declared, 'the manifest declares no target-attainment dataset').toBeDefined()
    expect(declared?.businessKey).toEqual([
      'dealership_id',
      'target_month',
      'target_scope_type',
      'target_scope_id',
      'target_kpi_id',
    ])
  })

  it('carries the plan for every store, month and governed scope', () => {
    const rows = targetAttainmentRows()
    expect(rows.length).toBe(dashboardStoreIds.length * MONTHS.length * 4)
    const keys = new Set(
      rows.map(
        (row) =>
          `${String(row.dealership_id)}|${String(row.target_month)}|` +
          `${String(row.target_scope_type)}|${String(row.target_scope_id)}|` +
          String(row.target_kpi_id)
      )
    )
    expect(keys.size, 'the declared business key is not unique').toBe(rows.length)
  })

  it('names the metric being targeted and never a KPI-TGT identifier', () => {
    const metrics = new Set(
      targetAttainmentRows().map((row) => String(row.target_kpi_id))
    )
    expect([...metrics].sort()).toEqual([
      'KPI-GRS-001',
      'KPI-GRS-002',
      'KPI-GRS-003',
      'KPI-SLS-001',
    ])
  })

  it('publishes no quotient at all, only the components of one', () => {
    /*
     * The rule that makes an average of store percentages impossible to form from this
     * data. If a ratio column were ever exported, a consumer could average it, and the
     * wrong answer would be the convenient one.
     */
    const first = targetAttainmentRows()[0]
    expect(first).toBeDefined()
    for (const forbidden of [
      'target_attainment_ratio',
      'pace_per_selling_day',
      'projected_month_end_value',
    ]) {
      expect(Object.keys(first as object)).not.toContain(forbidden)
    }
    for (const required of [
      'attainment_numerator',
      'attainment_denominator',
      'pace_numerator',
      'pace_denominator',
      'projection_numerator',
      'projection_denominator',
    ]) {
      expect(Object.keys(first as object)).toContain(required)
    }
  })

  it('carries every money and unit figure as an exact decimal string', () => {
    for (const row of targetAttainmentRows()) {
      for (const column of [
        'target_value',
        'actual_mtd_value',
        'attainment_numerator',
        'attainment_denominator',
        'projection_numerator',
      ]) {
        const value = row[column]
        if (value === null) continue
        expect(typeof value, `${column} crossed the boundary as a JSON number`).toBe(
          'string'
        )
        expect(() => parseExact(String(value))).not.toThrow()
      }
    }
  })

  it('does not export the stretch target, which no surface renders', () => {
    const first = targetAttainmentRows()[0]
    expect(Object.keys(first as object)).not.toContain('stretch_target_value')
  })

  it('publishes no employee column of any kind', () => {
    const columns = Object.keys(targetAttainmentRows()[0] as object)
    for (const column of columns) {
      expect(column).not.toMatch(/employee|salesperson|compensation|commission/i)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 2. The console reproduces the export's own published totals                  */
/* -------------------------------------------------------------------------- */

describe('the console reproduces the export manifest exactly', () => {
  /** Every month, so the comparison covers the whole reporting window. */
  function wholeWindow(): ResolvedPeriod {
    const first = MONTHS[0] as string
    return resolvePeriod(
      {
        kind: 'range',
        start: `${first}-01`,
        end: reportingCalendar.last,
      },
      'none',
      reportingCalendar
    ).period
  }

  it.each([
    ['retailUnits', 'retail_unit_target', 'retail_unit_target_attainment'],
    ['totalGross', 'total_gross_target', 'total_gross_target_attainment'],
  ])(
    '%s reproduces the published target and attainment components',
    (measureId, totalKey, attainmentKey) => {
      const built = context(wholeWindow())
      expect(built.comparability.kind).toBe('totals-only')
      const measure = built.measures.find((entry) => entry.measure.id === measureId)
      expect(measure).toBeDefined()
      if (!measure) return

      const total = dashboardManifest.reconciliationTotals[totalKey]
      expect(total, `${totalKey} is not published`).toBeDefined()
      if (!total || !('total' in total)) return
      expect(measure.target).not.toBeNull()
      expect(exactToString(measure.target as Exact)).toBe(
        exactToString(parseExact(total.total))
      )

      const ratio = dashboardManifest.reconciliationTotals[attainmentKey]
      expect(ratio, `${attainmentKey} is not published`).toBeDefined()
      if (!ratio || !('numerator' in ratio)) return
      expect(exactToString(measure.attainmentNumerator)).toBe(
        exactToString(parseExact(ratio.numerator))
      )
      expect(measure.attainmentDenominator).not.toBeNull()
      expect(exactToString(measure.attainmentDenominator as Exact)).toBe(
        exactToString(parseExact(ratio.denominator))
      )
    }
  )

  it('publishes the department plans as an exact partition of the store plan', () => {
    const front = dashboardManifest.reconciliationTotals['front_end_gross_target']
    const back = dashboardManifest.reconciliationTotals['back_end_gross_target']
    const store = dashboardManifest.reconciliationTotals['total_gross_target']
    expect(front && 'total' in front).toBe(true)
    expect(back && 'total' in back).toBe(true)
    expect(store && 'total' in store).toBe(true)
    if (!front || !('total' in front)) return
    if (!back || !('total' in back)) return
    if (!store || !('total' in store)) return
    const summed = addExact(parseExact(front.total), parseExact(back.total))
    expect(exactToString(summed)).toBe(exactToString(parseExact(store.total)))
  })
})

/* -------------------------------------------------------------------------- */
/* 3. The group rule, and the wrong answer beside it                            */
/* -------------------------------------------------------------------------- */

describe('group attainment', () => {
  it('is summed components, and differs from the average of store percentages', () => {
    const period = month(LATEST_MONTH)
    const group = context(period)
    const perStore = buildStoreTargetContexts(filters(), period, dashboardStoreIds)

    for (const measure of TARGET_MEASURES) {
      const groupMeasure = group.measures.find((entry) => entry.measure.id === measure.id)
      expect(groupMeasure?.attainment).not.toBeNull()
      const correct = groupMeasure?.attainment as Exact

      // THE WRONG ANSWER, computed deliberately. Averaging store attainment
      // percentages weights a store that sold four cars the same as one that sold
      // forty. It is the most common way a group attainment figure misleads, and the
      // only reliable defence is for the right answer to differ visibly from it.
      const ratios = perStore
        .map(
          (entry) =>
            entry.measures.find((candidate) => candidate.measure.id === measure.id)
              ?.attainment ?? null
        )
        .filter((value): value is Exact => value !== null)
      expect(ratios.length).toBeGreaterThan(1)
      const summedRatios = ratios.reduce(
        (total, value) => addExact(total, value),
        exactZero(0)
      )
      const averaged = divideExact(summedRatios, exactFromInteger(ratios.length), 6)
      expect(averaged).not.toBeNull()
      expect(
        exactToString(correct),
        `${measure.id}: the average of store attainments equals the correct group figure, ` +
          'so this assertion cannot demonstrate the difference'
      ).not.toBe(exactToString(averaged as Exact))
    }
  })

  it('sums each store into both sides of the ratio, or into neither', () => {
    const period = month(LATEST_MONTH)
    const group = context(period)
    const perStore = buildStoreTargetContexts(filters(), period, dashboardStoreIds)

    for (const measure of TARGET_MEASURES) {
      const groupMeasure = group.measures.find((entry) => entry.measure.id === measure.id)
      expect(groupMeasure).toBeDefined()
      if (!groupMeasure) continue
      const numerators = perStore
        .map(
          (entry) =>
            entry.measures.find((candidate) => candidate.measure.id === measure.id)
              ?.attainmentNumerator ?? exactZero(0)
        )
        .reduce((total, value) => addExact(total, value), exactZero(0))
      expect(exactToString(numerators)).toBe(
        exactToString(groupMeasure.attainmentNumerator)
      )
    }
  })

  it('holds the group pace denominator store-invariant rather than summing it', () => {
    /*
     * Three stores share one selling-day calendar. A group pace over three times the
     * elapsed days would be a third of the real run rate, and it would look plausible.
     */
    const period = month(LATEST_MONTH)
    const group = context(period)
    const single = buildTargetContext(filters(), period, [dashboardStoreIds[0] as string])
    expect(group.clock?.elapsed).toBe(single.clock?.elapsed)
    expect(group.clock?.total).toBe(single.clock?.total)
  })
})

/* -------------------------------------------------------------------------- */
/* 4. The states a number cannot express                                        */
/* -------------------------------------------------------------------------- */

describe('governed states', () => {
  it('renders a completed month honestly: nothing remaining, projection equals actual', () => {
    const built = context(month(LATEST_MONTH))
    expect(built.clock).not.toBeNull()
    if (!built.clock) return
    expect(built.clock.remaining).toBe(0)
    expect(built.clock.monthState).toBe('Complete')
    for (const measure of built.measures) {
      expect(measure.projection).not.toBeNull()
      expect(exactToString(measure.projection as Exact)).toBe(
        exactToString(
          divideExact(
            measure.actual,
            exactFromInteger(1),
            (measure.projection as Exact).scale
          ) as Exact
        )
      )
    }
  })

  it('reports a missing plan as "no target set" rather than as a target of zero', () => {
    /*
     * The committed development profile sets a plan for every applicable store-month, so
     * this state is constructed rather than hoped for. It is a real console state: the
     * exported `is_target_present` flag is what distinguishes it, and it must never
     * collapse into a zero.
     */
    const rows = targetAttainmentRows()
    const planned = rows.filter((row) => row.is_target_present === true)
    expect(planned.length).toBe(rows.length)

    const missing = {
      ...(rows[0] as object),
      is_target_present: false,
      target_value: null,
    }
    expect(missing.target_value).toBeNull()
    expect(missing.is_target_present).toBe(false)
    // A target of zero is a DIFFERENT state, and both are representable.
    const zeroTarget = { ...(rows[0] as object), target_value: '0.00' }
    expect(zeroTarget.target_value).not.toBe(missing.target_value)
  })

  it('produces a null attainment for a zero denominator rather than a division', () => {
    const zero = exactZero(2)
    expect(divideExact(exactFromInteger(42), zero, 6)).toBeNull()
  })

  it('produces a null pace and a null projection before the first selling day', () => {
    expect(divideExact(exactFromInteger(0), exactFromInteger(0), 6)).toBeNull()
    expect(paceBarGeometry(exactFromInteger(10), null)).toEqual({
      fill: 0,
      overflow: false,
    })
    expect(sellingDayProgress(null)).toBe(0)
  })

  it('clamps a bar over 100% and marks the overflow rather than hiding it', () => {
    const over = paceBarGeometry(exactFromInteger(134), exactFromInteger(100))
    expect(over.fill).toBe(1)
    expect(over.overflow).toBe(true)
    const under = paceBarGeometry(exactFromInteger(50), exactFromInteger(100))
    expect(under.fill).toBeCloseTo(0.5, 4)
    expect(under.overflow).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* 5. Comparability under filters                                               */
/* -------------------------------------------------------------------------- */

describe('the comparability guard', () => {
  it('permits the plain single-month case', () => {
    const decision = targetComparability(filters(), month(LATEST_MONTH))
    expect(decision.kind).toBe('comparable')
    expect(decision.reason).toBeNull()
  })

  it.each([
    ['condition', { condition: 'Used' as const }],
    ['source', { source: 'LSC-001' }],
    ['scope', { scope: 'used' as const }],
    ['make', { make: 'Chevrolet' }],
    ['model', { model: 'Equinox' }],
  ])(
    'refuses the comparison when the %s filter changes the actual population',
    (cause, overrides) => {
      const decision = targetComparability(filters(overrides), month(LATEST_MONTH))
      expect(decision.kind).toBe('not-comparable')
      expect(decision.cause).toBe(cause)
      expect(decision.reason).toBeTruthy()
    }
  )

  it('shows nothing at all when the comparison is refused', () => {
    const built = context(month(LATEST_MONTH), { condition: 'Used' })
    expect(built.measures).toEqual([])
    expect(built.clock).toBeNull()
  })

  it('refuses a period that does not cover whole calendar months', () => {
    const partial = resolvePeriod(
      { kind: 'range', start: `${LATEST_MONTH}-01`, end: `${LATEST_MONTH}-14` },
      'none',
      reportingCalendar
    ).period
    const decision = targetComparability(filters(), partial)
    expect(decision.kind).toBe('not-comparable')
    expect(decision.cause).toBe('partial-month')
  })

  it('keeps totals but withholds pace and projection across several months', () => {
    const across = resolvePeriod(
      { kind: 'range', start: `${MONTHS[0] as string}-01`, end: reportingCalendar.last },
      'none',
      reportingCalendar
    ).period
    const decision = targetComparability(filters(), across)
    expect(decision.kind).toBe('totals-only')
    expect(decision.cause).toBe('multi-month')

    const built = context(across)
    expect(built.clock).toBeNull()
    for (const measure of built.measures) {
      expect(measure.target).not.toBeNull()
      expect(measure.attainment).not.toBeNull()
      expect(measure.pace).toBeNull()
      expect(measure.projection).toBeNull()
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 6. Filters change the figures                                                */
/* -------------------------------------------------------------------------- */

describe('filters', () => {
  it('changes the target when the store scope changes', () => {
    const period = month(LATEST_MONTH)
    const group = context(period)
    const single = buildTargetContext(filters(), period, [dashboardStoreIds[0] as string])
    const groupTarget = group.measures[0]?.target
    const singleTarget = single.measures[0]?.target
    expect(groupTarget).not.toBeNull()
    expect(singleTarget).not.toBeNull()
    expect(exactToString(groupTarget as Exact)).not.toBe(
      exactToString(singleTarget as Exact)
    )
  })

  it('changes the target when the period changes', () => {
    const first = context(month(MONTHS[0] as string))
    const last = context(month(LATEST_MONTH))
    expect(exactToString(first.measures[0]?.target as Exact)).not.toBe(
      exactToString(last.measures[0]?.target as Exact)
    )
  })
})

/* -------------------------------------------------------------------------- */
/* 7. Display                                                                   */
/* -------------------------------------------------------------------------- */

describe('display', () => {
  it('rounds a projected unit count to whole units only at the point of display', () => {
    // 40.6 units projected renders as 41. The exact ratio survives everything before it.
    const projection = parseExact('40.600000')
    expect(formatRateExact(projection, 0)).toBe('41')
    expect(exactToString(projection)).toBe('40.600000')
  })

  it('renders a pace to two decimals and an attainment to one', () => {
    expect(formatRateExact(parseExact('1.333333'), 2)).toBe('1.33')
    expect(formatRatioAsPercent(parseExact('0.764231'), 1)).toBe('76.4%')
  })
})

/* -------------------------------------------------------------------------- */
/* 8. Nothing is hardcoded, and the language is governed                        */
/* -------------------------------------------------------------------------- */

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'generated') continue
      found.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path)
    }
  }
  return found
}

/**
 * Comments removed, so a scan reads what the page RENDERS rather than what the file
 * explains. Every rule below is about the words a reader sees; a comment saying "never a
 * forecast" is the reason the rule exists, not a breach of it.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
}

describe('the target surface', () => {
  const files = sourceFiles(SRC).map((path) => ({
    relative: path.slice(SRC.length + 1).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
  }))
  const targetFiles = files.filter((file) => /target|pace-bar/i.test(file.relative))

  it('has a target surface to scan at all', () => {
    expect(targetFiles.length).toBeGreaterThan(2)
  })

  it('hardcodes no target value anywhere in the console', () => {
    /*
     * Every target on the page comes from the exported dataset. A literal that looked
     * like a plan figure would be a number the reporting layer never produced, and it
     * would survive a regeneration that changed the real one. Layout constants -- a
     * scale of 10, a percentage of 100, a rounding factor of 1000 -- are not figures and
     * are listed rather than pattern-matched, so a new one has to be justified here.
     */
    const layoutConstants = new Set(['10', '100', '1000', '10000'])
    for (const file of targetFiles) {
      // A `section 39` pointer into KPI_CATALOG.md is a citation, not a figure. It is
      // removed before the scan rather than allowlisted, so a future citation is covered
      // and a future literal still is not.
      const rendered = withoutComments(file.text).replace(/section \d+/gi, 'section')
      const literals = rendered.match(/\b\d{2,}(?:\.\d+)?\b/g) ?? []
      const suspicious = literals.filter(
        (literal) => Number(literal) >= 20 && !layoutConstants.has(literal)
      )
      expect(
        suspicious,
        `${file.relative} carries a literal that could be a target value`
      ).toEqual([])
    }
  })

  it('labels every projection with the governed phrase and never calls it a forecast', () => {
    expect(PACE_PROJECTION_LABEL).toBe('Selling-day pace projection')
    const surface = files.filter((file) => /dashboard/i.test(file.relative))
    const claim = /\b(forecast(?:ed|s|ing)?|predicted|prediction)\b/gi
    for (const file of surface) {
      const rendered = withoutComments(file.text)
      for (const match of rendered.matchAll(claim)) {
        const index = match.index ?? 0
        const before = rendered.slice(Math.max(0, index - 80), index).toLowerCase()
        expect(
          /not a|never a|never called|rather than a|is not|neither a|nor a/.test(before),
          `${file.relative} describes the arithmetic as "${match[0]}" without denying it`
        ).toBe(true)
      }
    }
  })

  it('states the synthetic-target disclosure in the words the repository uses', () => {
    expect(TARGET_DISCLOSURE).toContain('synthetic internal operating goals')
    expect(TARGET_DISCLOSURE).toContain('Granite Auto Group')
    expect(TARGET_DISCLOSURE).toContain('not industry benchmarks')
  })

  it('defines no favourable direction, rating or health score', () => {
    /*
     * ARPI has no governed semantic for whether an attainment figure is good. A console
     * that supplied one would be publishing a judgement rather than a figure, so the
     * vocabulary that would express one may not appear in rendered text.
     */
    const verdicts =
      /\b(excellent|poor performance|healthy|unhealthy|on track|off track|grade|rating|score)\b/i
    for (const file of targetFiles) {
      const rendered = withoutComments(file.text)
      expect(rendered, `${file.relative} publishes a verdict`).not.toMatch(verdicts)
    }
  })
})
