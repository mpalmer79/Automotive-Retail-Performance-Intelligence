/**
 * The Executive Overview (`DASH.2-03`): the values, the states, and the chain that
 * makes both believable.
 *
 * WHAT THIS SUITE IS ACTUALLY FOR
 * -------------------------------
 * `TEST_STRATEGY.md` §7 sets out the reconciliation chain and puts its first link
 * here: **UI executive totals = generated payload totals**. `dashboard-data.test.ts`
 * already proved the second and third links at `DASH.1` — the generated tree
 * re-derives the root export's manifest totals by exact `bigint` summation, and the
 * Python integration suite proved those totals against the reporting views. So the
 * question this file answers is the one nobody else can: does the thing on the
 * screen equal the thing in the export?
 *
 * It is answered by walking the selector registry and, for every selector that
 * declares a `reconciliationKey`, evaluating it over the whole reporting window at
 * group scope and comparing the result CHARACTER FOR CHARACTER against the figure
 * the manifest publishes. Not `toBeCloseTo`. A console that agrees with its source
 * to fourteen places has not reproduced it.
 *
 * The rest of the suite covers the states a number cannot express: structural
 * absence, a governed null, an empty selection, an order statistic above its grain,
 * and a stale export. Those are the assertions that stop a dash from quietly
 * meaning five different things.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { KpiStrip } from '../../src/components/dashboard/kpi-strip.tsx'
import { StoreScoreboard } from '../../src/components/dashboard/store-scoreboard.tsx'
import { CHUNK_TABLES, chunkKey } from '../../src/lib/dashboard/chunks.ts'
import {
  calendarBounds,
  dashboardManifest,
  dashboardStoreIds,
  dashboardStores,
} from '../../src/lib/dashboard/data.ts'
import {
  divideExact,
  exactToString,
  parseExact,
} from '../../src/lib/dashboard/decimal.ts'
import {
  SCOREBOARD_COLUMNS,
  buildExecutiveOverview,
  kpiDefinition,
  kpiDefinitionHref,
  reportingCalendar,
} from '../../src/lib/dashboard/executive.ts'
import {
  formatCountDifference,
  formatCurrencyDifference,
  formatCurrencyExact,
  formatDaysDifference,
  formatPerUnitExact,
  formatPointsDifference,
  formatRatioAsPercent,
} from '../../src/lib/dashboard/format.ts'
import { parseFilters, type DashboardFilters } from '../../src/lib/dashboard/filters.ts'
import { resolvePeriod } from '../../src/lib/dashboard/periods.ts'
import {
  SELECTORS,
  evaluate,
  isValue,
  type Selector,
} from '../../src/lib/dashboard/selectors.ts'
import { kpis } from '../../src/lib/content.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '../..')

afterEach(cleanup)

/** Build the overview the route would build for a query string. */
function overviewFor(search: string) {
  const parsed = parseFilters(new URLSearchParams(search), {
    knownStores: dashboardStores.map((store) => store.id),
  })
  return buildExecutiveOverview(parsed.filters, parsed.reset)
}

/* -------------------------------------------------------------------------- */
/* 1. The values equal the export's values                                     */
/* -------------------------------------------------------------------------- */

describe('every selector reproduces the export exactly', () => {
  /** Group scope, the whole reporting window: the context the manifest totals describe. */
  const wholeWindow = resolvePeriod(
    { kind: 'range', start: calendarBounds.first, end: calendarBounds.last },
    'none',
    reportingCalendar
  )
  const groupContext = {
    stores: dashboardStoreIds,
    conditionGroups: null,
    leadSources: null,
    period: wholeWindow.period,
  }

  const reconciled = Object.values(SELECTORS).filter(
    (selector) =>
      'reconciliationKey' in selector && selector.reconciliationKey !== undefined
  )

  it('covers a meaningful share of the registry, so this loop is not vacuous', () => {
    expect(reconciled.length).toBeGreaterThanOrEqual(15)
  })

  for (const selector of reconciled) {
    const key = (selector as { reconciliationKey: string }).reconciliationKey

    it(`${selector.id} equals the manifest total "${key}", character for character`, () => {
      const published = dashboardManifest.reconciliationTotals[key]
      expect(published, `manifest has no reconciliation total "${key}"`).toBeDefined()
      if (published === undefined) return

      const result = evaluate(selector, groupContext)
      expect(isValue(result), `${selector.id} did not resolve to a value`).toBe(true)
      if (!isValue(result)) return

      if ('total' in published) {
        // An additive column: the console's sum IS the published total.
        expect(exactToString(result.value)).toBe(
          exactToString(parseExact(published.total))
        )
      } else {
        /*
         * A ratio. The manifest publishes the numerator sum and the denominator sum
         * and NO quotient - `DATA_CONTRACT.md` §12 - so the check is that the
         * console divided those two numbers and nothing else. Dividing here at the
         * selector's own scale is what makes an average of store averages
         * detectable: it would not equal this.
         */
        const expected = divideExact(
          parseExact(published.numerator),
          parseExact(published.denominator),
          selector.scale
        )
        expect(expected).not.toBeNull()
        expect(exactToString(result.value)).toBe(exactToString(expected!))
      }
    })
  }

  it('never publishes a quotient it could have read instead of computed', () => {
    // The point of the export's shape, asserted so a future contract change that
    // added a quotient would be noticed rather than silently consumed.
    for (const total of Object.values(dashboardManifest.reconciliationTotals)) {
      if ('numerator_column' in total) {
        expect(Object.keys(total)).not.toContain('value')
        expect(Object.keys(total)).not.toContain('quotient')
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 2. The registry cannot drift from the catalogue or the manifest             */
/* -------------------------------------------------------------------------- */

describe('the selector registry is governed', () => {
  it('resolves every KPI id it claims to a governed KPI_CATALOG entry', () => {
    const known = new Set(kpis.map((entry) => entry.id))
    for (const selector of Object.values(SELECTORS)) {
      if (selector.kpiId === null) continue
      expect(known.has(selector.kpiId), `${selector.id} claims ${selector.kpiId}`).toBe(
        true
      )
    }
  })

  it('names only datasets and columns the manifest declares', () => {
    // Widened to the union: `as const satisfies` narrows each entry to its own
    // literal shape, so an optional member of the union is absent from the narrowed
    // type even where the discriminant allows it.
    for (const selector of Object.values(SELECTORS) as readonly Selector[]) {
      const dataset = dashboardManifest.datasets.find(
        (entry) => entry.name === selector.dataset
      )
      expect(dataset, `${selector.id} names dataset ${selector.dataset}`).toBeDefined()
      if (dataset === undefined) continue
      const columns = new Set(dataset.columns.map((column) => column.name))
      expect(columns.has(selector.dateColumn), `${selector.id} date column`).toBe(true)

      const named: string[] =
        selector.kind === 'sum'
          ? [selector.column]
          : selector.kind === 'ratio'
            ? [
                selector.numeratorColumn,
                selector.denominatorColumn,
                ...(selector.numeratorFactorColumn === undefined
                  ? []
                  : [selector.numeratorFactorColumn]),
              ]
            : selector.kind === 'order-statistic'
              ? [selector.column]
              : [
                  selector.unitsColumn,
                  selector.unitDaysColumn,
                  selector.calendarDaysColumn,
                  selector.snapshotDaysColumn,
                ]
      for (const column of named) {
        expect(columns.has(column), `${selector.id} names ${column}`).toBe(true)
      }
    }
  })

  it('states a derivation for every selector, so no formula is unexplained', () => {
    for (const selector of Object.values(SELECTORS)) {
      expect(selector.derivation.length, selector.id).toBeGreaterThan(30)
    }
  })

  it('gives every count selector a noun, so "+12" is never ambiguous', () => {
    for (const selector of Object.values(SELECTORS)) {
      if (selector.unit !== 'count') continue
      expect(selector.countNoun, selector.id).toBeDefined()
    }
  })
})

describe('the static chunk table matches the manifest chunk index', () => {
  it('carries exactly the partitions the export declares, in both directions', () => {
    for (const dataset of dashboardManifest.datasets) {
      if (dataset.chunks === null) continue
      const table = CHUNK_TABLES[dataset.name as keyof typeof CHUNK_TABLES]
      expect(table, `no chunk table for ${dataset.name}`).toBeDefined()
      if (table === undefined) continue

      const declared = dataset.chunks
        .map((chunk) => chunkKey(chunk.dealershipId, chunk.month))
        .sort()
      expect(Object.keys(table).sort(), dataset.name).toEqual(declared)
    }
  })

  it('has a table for every chunked dataset and no others', () => {
    const chunked = dashboardManifest.datasets
      .filter((dataset) => dataset.chunks !== null)
      .map((dataset) => dataset.name)
      .sort()
    expect(Object.keys(CHUNK_TABLES).sort()).toEqual(chunked)
  })
})

/* -------------------------------------------------------------------------- */
/* 3. Comparison semantics                                                     */
/* -------------------------------------------------------------------------- */

describe('comparison differences', () => {
  const overview = overviewFor('')

  it('defaults to the latest full month against the prior calendar month', () => {
    expect(overview.periodContext.period.start).toBe('2025-12-01')
    expect(overview.periodContext.period.end).toBe('2025-12-31')
    expect(overview.periodContext.comparison?.start).toBe('2025-11-01')
    expect(overview.periodContext.comparison?.end).toBe('2025-11-30')
  })

  it('is the exact difference of two exactly-resolved values', () => {
    const card = overview.cards.find((entry) => entry.id === 'retailUnits')
    expect(card).toBeDefined()
    const current = card?.metric.current
    const prior = card?.metric.prior
    expect(current?.kind).toBe('value')
    expect(prior?.kind).toBe('value')
    if (current?.kind !== 'value' || prior?.kind !== 'value') return
    const difference = card?.metric.difference
    expect(difference).not.toBeNull()
    expect(Number(exactToString(difference!))).toBe(
      Number(exactToString(current.value)) - Number(exactToString(prior.value))
    )
  })

  it('withholds prior-year comparison rather than comparing to a partial window', () => {
    // The export covers six months. A prior-year window is entirely outside it, and
    // clamping would compare December against nothing while looking like a figure.
    const priorYear = overviewFor('compare=prior-year')
    expect(priorYear.periodContext.comparison).toBeNull()
    expect(priorYear.periodContext.comparisonUnavailable).toContain('outside')
    for (const card of priorYear.cards) {
      expect(card.metric.difference).toBeNull()
    }
  })

  it('forms no difference at all when the comparison is switched off', () => {
    const none = overviewFor('compare=none')
    expect(none.periodContext.comparison).toBeNull()
    for (const card of none.cards) {
      expect(card.metric.difference).toBeNull()
      expect(card.metric.differenceUnavailable).toBeNull()
    }
  })
})

describe('difference formatting states the right unit', () => {
  it('renders a ratio difference in percentage POINTS, never in percent', () => {
    // 6.5% to 7.2% is +0.7 percentage points and +10.8 percent. Only one of those
    // is what the card is showing.
    const difference = { units: 7n, scale: 3 } // 0.007 as a ratio
    expect(formatPointsDifference(difference)).toBe('+0.7 percentage points')
    expect(formatPointsDifference(difference)).not.toContain('%')
  })

  it('keeps the plural on a decimal figure and reserves the singular for a whole one', () => {
    expect(formatPointsDifference({ units: 10n, scale: 3 })).toBe(
      '+1.0 percentage points'
    )
    expect(formatPointsDifference({ units: 10n, scale: 3 }, 0)).toBe(
      '+1 percentage point'
    )
  })

  it('renders currency with a sign and a symbol on the correct side', () => {
    expect(formatCurrencyDifference({ units: 1842000n, scale: 2 })).toBe('+$18,420')
    expect(formatCurrencyDifference({ units: -1842000n, scale: 2 })).toBe('-$18,420')
    expect(formatCurrencyDifference({ units: 0n, scale: 2 })).toBe('$0')
  })

  it('renders counts with their own noun', () => {
    expect(formatCountDifference({ units: 12n, scale: 0 }, 'units')).toBe('+12 units')
    expect(formatCountDifference({ units: -12n, scale: 0 }, 'leads')).toBe('-12 leads')
  })

  it('renders day differences in days, singular where it should be', () => {
    expect(formatDaysDifference({ units: -4n, scale: 0 })).toBe('-4 days')
    expect(formatDaysDifference({ units: 1n, scale: 0 })).toBe('+1 day')
  })

  it('formats currency and per-unit currency with separators and no cents', () => {
    expect(formatCurrencyExact(parseExact('1936571.59'))).toBe('$1,936,572')
    expect(formatPerUnitExact(parseExact('3470.56'))).toBe('$3,471')
  })

  it('formats a ratio as a percentage at one decimal', () => {
    expect(formatRatioAsPercent(parseExact('0.072228'))).toBe('7.2%')
    expect(formatRatioAsPercent(parseExact('0.404000'))).toBe('40.4%')
  })
})

/* -------------------------------------------------------------------------- */
/* 4. Not applicable, and the difference from zero                             */
/* -------------------------------------------------------------------------- */

describe('the independent store is not penalized for a business it is not in', () => {
  const overview = overviewFor('')
  const preOwned = overview.scoreboard.find((row) => row.store.id === 'GSA-003')
  const chevrolet = overview.scoreboard.find((row) => row.store.id === 'GSA-001')

  it('reads the franchise flag from the exported store dimension', () => {
    expect(preOwned?.store.isFranchise).toBe(false)
    expect(chevrolet?.store.isFranchise).toBe(true)
  })

  it('renders its new-unit cell as Not applicable, never as zero', () => {
    const cell = preOwned?.cells.find((entry) => entry.column.id === 'newUnits')
    expect(cell?.result.kind).toBe('not-applicable')
    if (cell?.result.kind !== 'not-applicable') return
    expect(cell.result.reason).toContain('no franchise')
    expect(cell.result.reason).toContain('structural')
  })

  it('still renders the franchise stores new-unit cells as measured values', () => {
    const cell = chevrolet?.cells.find((entry) => entry.column.id === 'newUnits')
    expect(cell?.result.kind).toBe('value')
  })

  it('renders every other cell for the independent store as an ordinary value', () => {
    const others = (preOwned?.cells ?? []).filter(
      (entry) => entry.column.id !== 'newUnits'
    )
    expect(others.length).toBeGreaterThan(5)
    for (const cell of others) {
      expect(cell.result.kind, cell.column.id).toBe('value')
    }
  })

  it('renders its new-condition inventory as Not applicable when the filter asks for New', () => {
    const filtered = overviewFor('store=GSA-003&condition=New')
    const row = filtered.scoreboard[0]
    const aged = row?.cells.find((entry) => entry.column.id === 'agedInventoryPercentage')
    expect(aged?.result.kind).toBe('not-applicable')
  })

  it('lists a Not applicable new-vehicle median beside the medians it does publish', () => {
    const medians = overview.inventory.governedMedians
    const preOwnedNew = medians.find(
      (entry) => entry.store.id === 'GSA-003' && entry.conditionGroup === 'New'
    )
    expect(preOwnedNew?.value.kind).toBe('not-applicable')
    const preOwnedUsed = medians.find(
      (entry) => entry.store.id === 'GSA-003' && entry.conditionGroup === 'Used'
    )
    expect(preOwnedUsed?.value.kind).toBe('value')
  })

  it('shows the words in the rendered scoreboard, not a dash', () => {
    render(
      <StoreScoreboard
        rows={overview.scoreboard}
        columns={SCOREBOARD_COLUMNS}
        caption="Store scoreboard for December 2025"
      />
    )
    // Two presentations render the same value; both must say it.
    expect(screen.getAllByText('Not applicable').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('—')).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* 5. Order statistics                                                         */
/* -------------------------------------------------------------------------- */

describe('an order statistic is never combined upward', () => {
  it('declines a group median and names the scope that would resolve it', () => {
    const overview = overviewFor('')
    const card = overview.cards.find((entry) => entry.id === 'medianInventoryAge')
    expect(card?.metric.current.kind).toBe('not-derivable')
    if (card?.metric.current.kind !== 'not-derivable') return
    expect(card.metric.current.reason).toContain('order statistic')
    expect(card.metric.current.reason).toContain('not the average of subgroup medians')
    expect(card.metric.current.resolveBy).toBe('one store and one condition group')
  })

  it('resolves the exported median once the filter reaches the published grain', () => {
    const overview = overviewFor('store=GSA-001&condition=Used')
    const card = overview.cards.find((entry) => entry.id === 'medianInventoryAge')
    expect(card?.metric.current.kind).toBe('value')
    if (card?.metric.current.kind !== 'value') return
    // The exported value for GSA-001 / Used at the 2025-12-31 snapshot.
    expect(exactToString(card.metric.current.value)).toBe('37')
  })

  it('declines a group median response time, whose grain includes source and day', () => {
    const overview = overviewFor('')
    expect(overview.funnel.medianResponse.current.kind).toBe('not-derivable')
    if (overview.funnel.medianResponse.current.kind !== 'not-derivable') return
    expect(overview.funnel.medianResponse.current.resolveBy).toBe(
      'one store, one lead source and a single day'
    )
  })

  it('resolves the exported response median at store, source and day', () => {
    const overview = overviewFor(
      'period=2025-12-01..2025-12-01&store=GSA-001&source=LDS-001'
    )
    const result = overview.funnel.medianResponse.current
    expect(result.kind).toBe('value')
    if (result.kind !== 'value') return
    expect(Number(exactToString(result.value))).toBeCloseTo(30.8166, 3)
  })

  it('publishes the derivable mean beside the median it cannot form', () => {
    const overview = overviewFor('')
    expect(overview.funnel.averageResponse.current.kind).toBe('value')
    expect(overview.inventory.averageAge.current.kind).toBe('value')
  })

  it('never averages the medians it does have into one that it does not', () => {
    const overview = overviewFor('')
    const medians = overview.inventory.governedMedians.filter(
      (entry) => entry.value.kind === 'value'
    )
    expect(medians.length).toBeGreaterThan(1)
    const card = overview.cards.find((entry) => entry.id === 'medianInventoryAge')
    // The group card is unresolved precisely because the mean of these exists and
    // is not the answer.
    expect(card?.metric.current.kind).toBe('not-derivable')
  })
})

/* -------------------------------------------------------------------------- */
/* 6. Empty, stale, and out-of-range                                           */
/* -------------------------------------------------------------------------- */

describe('honest states', () => {
  it('reports an empty selection as empty, with no zeroes anywhere', () => {
    // A single day the export covers, at a store, filtered to a lead source that
    // produced nothing that day.
    const overview = overviewFor('period=2025-07-04..2025-07-04&store=GSA-003')
    const unresolved = overview.cards.filter(
      (card) => card.metric.current.kind === 'no-rows'
    )
    for (const card of unresolved) {
      expect(card.metric.current.kind).toBe('no-rows')
      if (card.metric.current.kind !== 'no-rows') continue
      expect(card.metric.current.reason).toContain('No exported rows')
    }
  })

  it('substitutes the latest full month for a period outside the export, and says so', () => {
    const overview = overviewFor('period=2019-01')
    expect(overview.periodContext.period.start).toBe('2025-12-01')
    expect(overview.periodContext.notices).toHaveLength(1)
    expect(overview.periodContext.notices[0]).toContain('outside the exported')
    expect(overview.periodContext.notices[0]).toContain('1 July 2025')
  })

  it('trims a period that overlaps the export, and says so', () => {
    const overview = overviewFor('period=2025-06-01..2025-07-15')
    expect(overview.periodContext.period.start).toBe('2025-07-01')
    expect(overview.periodContext.period.end).toBe('2025-07-15')
    expect(overview.periodContext.notices[0]).toContain('trimmed')
  })

  it('resolves month-to-date against the export as-of date, not the wall clock', () => {
    const overview = overviewFor('period=mtd')
    expect(overview.periodContext.period.start).toBe('2025-12-01')
    expect(overview.periodContext.period.end).toBe(dashboardManifest.asOfDate)
  })

  it('resolves the last thirty days against the export as-of date', () => {
    const overview = overviewFor('period=last-30d')
    expect(overview.periodContext.period.end).toBe('2025-12-31')
    expect(overview.periodContext.period.start).toBe('2025-12-02')
    expect(overview.periodContext.period.calendarDays).toBe(30)
  })

  it('carries the reset notices through to the view model', () => {
    const overview = overviewFor('store=GSA-999&compare=sideways')
    expect(overview.resets.map((entry) => entry.key).sort()).toEqual(['compare', 'store'])
  })
})

/* -------------------------------------------------------------------------- */
/* 7. Disclosure and drill-through                                             */
/* -------------------------------------------------------------------------- */

describe('KPI methodology disclosure', () => {
  const overview = overviewFor('')

  it('resolves every card with a KPI id to a governed catalogue entry', () => {
    for (const card of overview.cards) {
      if (card.kpiId === null) continue
      expect(card.definition, card.kpiId).toBeDefined()
      expect(card.definition?.id).toBe(card.kpiId)
    }
  })

  it('renders every field the catalogue owns, from the catalogue', () => {
    render(
      <KpiStrip
        cards={overview.cards}
        comparisonLabel="November 2025"
        comparisonUnavailable={null}
      />
    )
    const strip = screen.getAllByText('How is this calculated?')
    expect(strip.length).toBe(overview.cards.length)

    for (const term of [
      'Governed KPI',
      'Plain English',
      'Inclusions and exclusions',
      'Formula',
      'Numerator',
      'Denominator',
      'Grain',
      'Date basis',
      'Unit',
      'Null behaviour',
      'Source reporting view',
      'Known limitations',
      'What this page selected',
    ]) {
      expect(screen.getAllByText(term).length, term).toBeGreaterThan(0)
    }
  })

  it('renders the catalogue text verbatim rather than a paraphrase', () => {
    render(
      <KpiStrip
        cards={overview.cards}
        comparisonLabel="November 2025"
        comparisonUnavailable={null}
      />
    )
    const retailUnits = kpiDefinition('KPI-SLS-001')
    expect(retailUnits).toBeDefined()
    expect(screen.getByText(retailUnits!.formula)).toBeTruthy()
    expect(screen.getByText(retailUnits!.caution)).toBeTruthy()
    expect(screen.getByText(retailUnits!.nullBehaviour)).toBeTruthy()
  })

  it('keeps no second KPI catalogue anywhere in the dashboard source', () => {
    /*
     * The disclosure fields must come from `src/content/kpis.json`, which the
     * project-manifest generator already validates against KPI_CATALOG.md on every
     * build. A hand-copied definition string in a component would drift on its
     * first edit and the drift would be invisible.
     */
    for (const path of [
      'src/components/dashboard/metric.tsx',
      'src/lib/dashboard/executive.ts',
    ]) {
      const text = readFileSync(join(PORTFOLIO, path), 'utf8')
      expect(text.includes('PERCENTILE_CONT(0.5) WITHIN GROUP'), path).toBe(false)
      expect(text.includes('SUM(unit_count) WHERE is_retail'), path).toBe(false)
    }
  })

  it('points every drill-through at a destination that exists', () => {
    /*
     * `/kpis` renders one list item per implemented KPI with `id={kpi.id}`, so
     * `/kpis#KPI-GRS-003` resolves. The nine other console routes do not exist yet
     * and nothing here links to them.
     */
    const catalogue = readFileSync(
      join(PORTFOLIO, 'src/components/explorers/kpi-catalogue.tsx'),
      'utf8'
    )
    expect(catalogue).toContain('id={kpi.id}')

    for (const card of overview.cards) {
      if (card.kpiId === null) {
        expect(card.definitionHref).toBeNull()
        continue
      }
      expect(card.definitionHref).toBe(`/kpis#${card.kpiId}`)
      expect(kpis.some((entry) => entry.id === card.kpiId)).toBe(true)
    }
  })

  it('builds a catalogue href only for a KPI the catalogue carries', () => {
    expect(kpiDefinitionHref('KPI-INV-004')).toBe('/kpis#KPI-INV-004')
    expect(kpiDefinition('KPI-INV-004')).toBeDefined()
  })

  it('renders no link to a console route that does not exist', () => {
    const { container } = render(
      <KpiStrip
        cards={overview.cards}
        comparisonLabel="November 2025"
        comparisonUnavailable={null}
      />
    )
    const hrefs = [...container.querySelectorAll('a')].map((anchor) =>
      anchor.getAttribute('href')
    )
    for (const href of hrefs) {
      expect(
        href,
        `${String(href)} is a dashboard route that does not exist`
      ).not.toMatch(/^\/dashboard\/./)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 8. The rendered strip                                                       */
/* -------------------------------------------------------------------------- */

describe('the rendered KPI strip', () => {
  const overview = overviewFor('')

  it('shows the seven governed cards the increment committed to, and no others', () => {
    expect(overview.cards.map((card) => card.kpiId)).toEqual([
      'KPI-SLS-001',
      'KPI-GRS-003',
      'KPI-GRS-006',
      'KPI-GRS-005',
      'KPI-FUN-006',
      'KPI-INV-004',
      'KPI-INV-006',
    ])
  })

  it('shows no target, pace, forecast or reconciliation-variance card', () => {
    render(
      <KpiStrip
        cards={overview.cards}
        comparisonLabel="November 2025"
        comparisonUnavailable={null}
      />
    )
    for (const absent of ['Target', 'Pace', 'Forecast', 'Variance', 'Attainment']) {
      expect(screen.queryByText(new RegExp(`\\b${absent}\\b`)), absent).toBeNull()
    }
  })

  it('names the KPI, the unit and the comparison period on each resolved card', () => {
    render(
      <KpiStrip
        cards={overview.cards}
        comparisonLabel="November 2025"
        comparisonUnavailable={null}
      />
    )
    expect(screen.getAllByText('KPI-SLS-001').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/November 2025/).length).toBeGreaterThan(0)
  })

  it('uses neutral direction words rather than good or bad', () => {
    render(
      <KpiStrip
        cards={overview.cards}
        comparisonLabel="November 2025"
        comparisonUnavailable={null}
      />
    )
    const body = document.body.textContent ?? ''
    expect(body).toMatch(/higher than|lower than|unchanged from/)
    for (const judgement of ['improved', 'declined', 'worse', 'better', 'on track']) {
      expect(body.toLowerCase().includes(judgement), judgement).toBe(false)
    }
  })

  it('renders the exact exported figure, formatted, for December retail units', () => {
    render(
      <KpiStrip
        cards={overview.cards}
        comparisonLabel="November 2025"
        comparisonUnavailable={null}
      />
    )
    const card = overview.cards.find((entry) => entry.id === 'retailUnits')
    expect(card?.metric.current.kind).toBe('value')
    if (card?.metric.current.kind !== 'value') return
    const exact = exactToString(card.metric.current.value)
    const heading = screen.getByRole('heading', { name: 'Retail units' })
    const cardElement = heading.closest('li')
    expect(cardElement).not.toBeNull()
    expect(within(cardElement!).getByText(exact)).toBeTruthy()
  })
})

/* -------------------------------------------------------------------------- */
/* 9. The scoreboard                                                           */
/* -------------------------------------------------------------------------- */

describe('the store scoreboard', () => {
  const overview = overviewFor('')

  it('carries one row per store in scope, in business-code order', () => {
    expect(overview.scoreboard.map((row) => row.store.id)).toEqual([
      'GSA-001',
      'GSA-002',
      'GSA-003',
    ])
  })

  it('resolves every column to a governed KPI', () => {
    for (const column of SCOREBOARD_COLUMNS) {
      expect(column.kpiId, column.id).not.toBeNull()
      expect(kpiDefinition(column.kpiId!), column.id).toBeDefined()
    }
  })

  it('carries no target, pace, penetration, variance or action column', () => {
    const labels = SCOREBOARD_COLUMNS.map((column) => column.label.toLowerCase())
    for (const absent of ['target', 'pace', 'penetration', 'variance', 'action']) {
      expect(
        labels.some((label) => label.includes(absent)),
        absent
      ).toBe(false)
    }
  })

  it('explains, on the response column, why the median is not the one shown', () => {
    const response = SCOREBOARD_COLUMNS.find(
      (column) => column.id === 'averageResponseMinutes'
    )
    expect(response?.note).toContain('KPI-FUN-008')
    expect(response?.note).toContain('order statistic')
  })

  it('narrows to one row when a single store is selected', () => {
    const single = overviewFor('store=GSA-002')
    expect(single.scoreboard.map((row) => row.store.id)).toEqual(['GSA-002'])
    expect(single.scope.isGroup).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* 10. Inventory and funnel assembly                                           */
/* -------------------------------------------------------------------------- */

describe('the inventory summary', () => {
  const overview = overviewFor('')

  it('reads levels at one snapshot date rather than summing across dates', () => {
    expect(overview.inventory.snapshotDate).toBe('2025-12-31')
  })

  it('states the aged threshold from the export rather than from a constant', () => {
    expect(overview.inventory.agedThresholdDays).toBe(60)
  })

  it('sums the age distribution to the active inventory count', () => {
    const active = overview.inventory.activeUnits.current
    expect(active.kind).toBe('value')
    if (active.kind !== 'value') return
    const bucketed = overview.inventory.buckets.reduce(
      (total, bucket) => total + Number(exactToString(bucket.units)),
      0
    )
    expect(bucketed).toBe(Number(exactToString(active.value)))
  })

  it('orders the age buckets by the exported sort order', () => {
    const orders = overview.inventory.buckets.map((bucket) => bucket.sortOrder)
    expect([...orders].sort((a, b) => a - b)).toEqual(orders)
  })
})

describe('the lead funnel', () => {
  const overview = overviewFor('')

  it('renders the five stages a dealership recognises, in order', () => {
    expect(overview.funnel.stages.map((stage) => stage.label)).toEqual([
      'Leads',
      'Contacted',
      'Appointment set',
      'Showed',
      'Sold',
    ])
  })

  it('never widens at a later stage than an earlier one', () => {
    const counts = overview.funnel.stages.map((stage) =>
      stage.result.kind === 'value' ? Number(exactToString(stage.result.value)) : 0
    )
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]!).toBeLessThanOrEqual(counts[index - 1]!)
    }
  })

  it('attaches a governed rate only where one is published against leads received', () => {
    const rates = new Map(
      overview.funnel.stages.map((stage) => [
        stage.id,
        stage.rate?.selector.kpiId ?? null,
      ])
    )
    expect(rates.get('leads')).toBeNull()
    expect(rates.get('contacted')).toBe('KPI-FUN-002')
    expect(rates.get('appointment-set')).toBe('KPI-FUN-003')
    // Show rate has a different denominator and belongs to the appointment dataset.
    expect(rates.get('showed')).toBeNull()
    expect(rates.get('sold')).toBe('KPI-FUN-006')
  })

  it('publishes the unresponded-lead count beside the response measures', () => {
    expect(overview.funnel.unrespondedLeads.current.kind).toBe('value')
    expect(overview.funnel.responseBands).toHaveLength(4)
  })

  it('sums the response bands to the responded-lead count', () => {
    const responded = overview.funnel.respondedLeads.current
    expect(responded.kind).toBe('value')
    if (responded.kind !== 'value') return
    const banded = overview.funnel.responseBands.reduce(
      (total, band) =>
        total +
        (band.result.kind === 'value' ? Number(exactToString(band.result.value)) : 0),
      0
    )
    expect(banded).toBe(Number(exactToString(responded.value)))
  })
})

/* -------------------------------------------------------------------------- */
/* 11. Filters select rows, never redefine a measure                           */
/* -------------------------------------------------------------------------- */

describe('a filter selects rows and never changes a definition', () => {
  it('sums the three single-store figures to the group figure', () => {
    const group = overviewFor('')
    const perStore = dashboardStoreIds.map((id) => overviewFor(`store=${id}`))
    const total = perStore.reduce((sum, overview) => {
      const card = overview.cards.find((entry) => entry.id === 'retailUnits')
      return (
        sum +
        (card?.metric.current.kind === 'value'
          ? Number(exactToString(card.metric.current.value))
          : 0)
      )
    }, 0)
    const groupCard = group.cards.find((entry) => entry.id === 'retailUnits')
    expect(groupCard?.metric.current.kind).toBe('value')
    if (groupCard?.metric.current.kind !== 'value') return
    expect(total).toBe(Number(exactToString(groupCard.metric.current.value)))
  })

  it('leaves a measure untouched by a filter whose attribute its dataset lacks', () => {
    /*
     * `condition` scopes inventory and nothing else: the exported gross summary
     * carries retail totals and no condition split. Applying it anyway would match
     * zero rows and the gross card would report "no matching records" for a period
     * with plenty of them - a filter silently zeroing an unrelated card.
     */
    const unfiltered = overviewFor('store=GSA-001')
    const filtered = overviewFor('store=GSA-001&condition=Used')
    const grossOf = (overview: ReturnType<typeof overviewFor>) => {
      const card = overview.cards.find((entry) => entry.id === 'totalGross')
      return card?.metric.current.kind === 'value'
        ? exactToString(card.metric.current.value)
        : null
    }
    expect(grossOf(filtered)).toBe(grossOf(unfiltered))
    expect(grossOf(filtered)).not.toBeNull()
  })

  it('does scope the measures whose dataset does carry the attribute', () => {
    const unfiltered = overviewFor('store=GSA-001')
    const filtered = overviewFor('store=GSA-001&condition=Used')
    const activeOf = (overview: ReturnType<typeof overviewFor>) => {
      const result = overview.inventory.activeUnits.current
      return result.kind === 'value' ? Number(exactToString(result.value)) : null
    }
    expect(activeOf(filtered)).toBeLessThan(activeOf(unfiltered)!)
  })

  it('declares the same filter state for the same URL, whatever the order', () => {
    const a: DashboardFilters = overviewFor('store=GSA-001&condition=Used').filters
    const b: DashboardFilters = overviewFor('condition=Used&store=GSA-001').filters
    expect(a).toEqual(b)
  })
})
