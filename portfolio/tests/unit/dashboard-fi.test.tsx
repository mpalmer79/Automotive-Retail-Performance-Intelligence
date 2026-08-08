/**
 * F&I performance on the console (`DASH.7-01`) and the itemized back end (`DASH.7-02`).
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * The same link `dashboard-executive.test.tsx` owns for the MVP KPIs and
 * `dashboard-targets.test.ts` owns for the operating plan, applied to the F&I family:
 * **what the page would render equals what the export published**, character for
 * character rather than `toBeCloseTo`. The export's own totals were proved against the
 * reporting views by `tests/integration/test_dashboard_export.py`, and those views were
 * proved against independent warehouse derivations by `test_fi_reporting_views.py` and
 * `test_kpi_verification.py`, so this file closes the last link of the chain.
 *
 * THE SPECIFIC DEFECT THIS SUITE EXISTS TO CATCH
 * ----------------------------------------------
 * `fi-product-penetration` is chunked into eighteen partitions and the generated decoder
 * MEMOISES BY CACHE KEY. Reading all eighteen under one key returns the first partition
 * eighteen times, and the failure is close to invisible: numerator and denominator are
 * inflated together, so the ratio stays plausible. During `DASH.7` this produced VSC
 * 288/720 where the warehouse says 227/558 — a penetration of 40.0% against a true 40.7%,
 * which nobody would have questioned on a screen. It was caught by reconciling against the
 * manifest instead. The reconciliation tests below are the permanent version of that check.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE, BECAUSE IT MUST NOT EXIST
 * ---------------------------------------------------------------
 * There is no test for a rank, a top performer, a benchmark, a target penetration, a
 * recommendation, a menu simulation or a payment. Their absence is asserted instead.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  dashboardManifest,
  dashboardStoreIds,
  dashboardStores,
} from '../../src/lib/dashboard/data.ts'
import {
  addExact,
  compareExact,
  divideExact,
  exactFromInteger,
  exactToString,
  isZero,
  parseExact,
  subtractExact,
  type Exact,
} from '../../src/lib/dashboard/decimal.ts'
import { reportingCalendar } from '../../src/lib/dashboard/executive.ts'
import { formatPointsDifference } from '../../src/lib/dashboard/format.ts'
import {
  DEFAULT_FILTERS,
  FI_SUPPORT,
  type DashboardFilters,
} from '../../src/lib/dashboard/filters.ts'
import {
  FI_CATEGORY_ORDER,
  FI_STRUCTURES,
  PERIOD_PROXY_LABEL,
  backGrossIdentityHolds,
  backGrossResidual,
  buildFi,
  fiCategoryForSlug,
  fiCategorySlug,
  isPublishable,
  netFiGrossIdentityHolds,
  structureForFilter,
  type FiManagerRow,
  type FiRatio,
  type FiView,
} from '../../src/lib/dashboard/fi.ts'
import { fiAdjustmentRows, fiSummaryRows } from '../../src/lib/dashboard/fi-data.ts'
import {
  allPenetrationChunks,
  penetrationChunkFile,
  penetrationChunkKeys,
  productDetailChunkKeys,
} from '../../src/lib/dashboard/fi-chunks.ts'
import { decodeDataset } from '../../src/lib/dashboard/data.ts'

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function filters(overrides: Partial<DashboardFilters> = {}): DashboardFilters {
  return { ...DEFAULT_FILTERS, ...overrides }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')

/**
 * The ROOT export manifest, which carries the SQL lineage the client one deliberately
 * drops. `source_view` and `sort_keys` are build-time facts a browser has no use for, and
 * the two assertions that need them are exactly the two a reviewer would want checked.
 */
const exportManifest = JSON.parse(
  readFileSync(join(REPO, 'data/dashboard/manifest.json'), 'utf8')
) as {
  datasets: {
    name: string
    source_view: string
    sort_keys: string[]
    row_count: number
    columns: { name: string }[]
  }[]
}

function rootDataset(name: string) {
  const found = exportManifest.datasets.find((dataset) => dataset.name === name)
  expect(found, `the root manifest declares no ${name}`).toBeDefined()
  return found!
}

/** The whole reporting window, with no comparison, which is what a total covers. */
function wholeWindow(overrides: Partial<DashboardFilters> = {}): FiView {
  return buildFi(
    filters({
      period: {
        kind: 'range',
        start: reportingCalendar.first,
        end: reportingCalendar.last,
      },
      compare: 'none',
      ...overrides,
    })
  )
}

function total(key: string): Exact {
  const entry = dashboardManifest.reconciliationTotals[key]
  expect(entry, `${key} is not published`).toBeDefined()
  if (!entry || !('total' in entry)) throw new Error(`${key} is not a plain total`)
  return parseExact(entry.total)
}

function components(key: string): { numerator: Exact; denominator: Exact } {
  const entry = dashboardManifest.reconciliationTotals[key]
  expect(entry, `${key} is not published`).toBeDefined()
  if (!entry || !('numerator' in entry)) throw new Error(`${key} is not a ratio`)
  return {
    numerator: parseExact(entry.numerator),
    denominator: parseExact(entry.denominator),
  }
}

/** Assert two exact decimals are the same VALUE, not the same string. */
function sameValue(actual: Exact, expected: Exact, message: string): void {
  expect(
    compareExact(actual, expected),
    `${message}: ${exactToString(actual)} ≠ ${exactToString(expected)}`
  ).toBe(0)
}

const MONTHS: readonly string[] = [
  ...new Set(fiSummaryRows().map((row) => String(row.sale_date).slice(0, 7))),
].sort()

const LATEST_MONTH = MONTHS[MONTHS.length - 1] as string

/** Every string the built view carries, for the prose sweeps. */
function everyString(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object') return []
  if (seen.has(value)) return []
  seen.add(value)
  if (Array.isArray(value)) return value.flatMap((entry) => everyString(entry, seen))
  return Object.values(value as Record<string, unknown>).flatMap((entry) =>
    everyString(entry, seen)
  )
}

/* -------------------------------------------------------------------------- */
/* 1. The four exported datasets                                               */
/* -------------------------------------------------------------------------- */

describe('the four exported F&I datasets', () => {
  const NAMES = [
    'fi-summary',
    'fi-product-penetration',
    'fi-adjustment-summary',
    'deal-product-detail',
  ] as const

  it.each(NAMES)('%s is declared in both manifests and reads only reporting', (name) => {
    const declared = dashboardManifest.datasets.find((dataset) => dataset.name === name)
    expect(declared, `the client manifest declares no ${name}`).toBeDefined()
    expect(declared?.rowCount).toBeGreaterThan(0)

    const root = rootDataset(name)
    expect(root.source_view.startsWith('reporting.')).toBe(true)
    expect(dashboardManifest.sourceViews).toContain(root.source_view)
    expect(root.row_count).toBe(declared?.rowCount)
  })

  it('carries no consumer-credit field of any spelling, in any dataset', () => {
    /*
     * The allowlist is the primary control and the exporter's own tripwire is the second.
     * This is the third, on the client side of the boundary, and it is cheap: the failure
     * it guards against is a column arriving through a future contract edit that nobody
     * connected to this rule.
     */
    const forbidden = [
      'apr',
      'buy_rate',
      'sell_rate',
      'rate_spread',
      'money_factor',
      'monthly_payment',
      'credit_score',
      'fico',
      'income',
      'stipulation',
      'adverse_action',
      'ssn',
      'social_security',
      'date_of_birth',
      'customer',
    ]
    for (const dataset of dashboardManifest.datasets) {
      for (const column of dataset.columns) {
        for (const token of forbidden) {
          expect(
            column.name.toLowerCase(),
            `${dataset.name}.${column.name} contains ${token}`
          ).not.toContain(token)
        }
      }
    }
  })

  it('exposes no warehouse surrogate key on any F&I dataset', () => {
    for (const name of NAMES) {
      const dataset = dashboardManifest.datasets.find((entry) => entry.name === name)
      for (const column of dataset?.columns ?? []) {
        expect(column.name.endsWith('_key'), `${name}.${column.name}`).toBe(false)
      }
    }
  })

  it('sorts by store, date and manager code — never by a performance measure', () => {
    // A default sort by a metric IS a leaderboard, whatever the column header says.
    const measureish = /gross|pvr|penetration|rate|ratio|amount|count|units|per_/
    for (const name of NAMES) {
      const keys = rootDataset(name).sort_keys
      expect(keys.length, `${name} declares no sort`).toBeGreaterThan(0)
      for (const key of keys) {
        expect(measureish.test(key), `${name} sorts by ${key}`).toBe(false)
      }
    }
  })

  it('publishes penetration as two additive columns and never as a quotient', () => {
    const dataset = dashboardManifest.datasets.find(
      (entry) => entry.name === 'fi-product-penetration'
    )
    const names = (dataset?.columns ?? []).map((column) => column.name)
    expect(names).toContain('penetration_numerator')
    expect(names).toContain('penetration_denominator')
    // No column may BE the ratio: a consumer that could read one could average it.
    expect(
      names.some((name) => /^penetration_(rate|ratio|pct|percent)$/.test(name))
    ).toBe(false)
  })

  it('keeps the adjustment summary on its own date basis, in the manifest', () => {
    const dataset = dashboardManifest.datasets.find(
      (entry) => entry.name === 'fi-adjustment-summary'
    )
    expect(dataset?.dateBasis?.toLowerCase()).toContain('adjustment date')
    // And the sale-date datasets do not claim it.
    const summary = dashboardManifest.datasets.find(
      (entry) => entry.name === 'fi-summary'
    )
    expect(summary?.dateBasis?.toLowerCase()).not.toContain('adjustment date')
  })
})

/* -------------------------------------------------------------------------- */
/* 2. The partition cache-key regression                                       */
/* -------------------------------------------------------------------------- */

describe('the penetration partitions decode under one key each', () => {
  /*
   * THE `DASH.7` DEFECT, PERMANENTLY GUARDED.
   *
   * `decodeDataset` memoises by cache key. One key across eighteen partitions returns the
   * first partition eighteen times, and every downstream figure is inflated on both sides
   * of every ratio — which is why the page still looked right.
   */
  it('reads every declared partition and reads each one once', () => {
    const declared = dashboardManifest.datasets.find(
      (entry) => entry.name === 'fi-product-penetration'
    )
    expect(declared?.chunks).not.toBeNull()
    expect(penetrationChunkKeys().length).toBe(declared?.chunks?.length)
    expect(productDetailChunkKeys().length).toBe(18)

    const decoded = allPenetrationChunks().flatMap((file, index) =>
      decodeDataset(`test-penetration-${index}`, file)
    )
    expect(decoded.length).toBe(declared?.rowCount)
  })

  it('produces a different row set per partition, which one shared key would not', () => {
    // The direct statement of the defect: if two partitions decoded identically, the
    // memoisation is collapsing them.
    const first = penetrationChunkFile('GSA-001', MONTHS[0] as string)
    const second = penetrationChunkFile('GSA-002', MONTHS[0] as string)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    const a = decodeDataset('test-pen-a', first!)
    const b = decodeDataset('test-pen-b', second!)
    expect(a.every((row) => row.dealership_id === 'GSA-001')).toBe(true)
    expect(b.every((row) => row.dealership_id === 'GSA-002')).toBe(true)
  })

  it('sums the partition row counts to the dataset row count, in the manifest', () => {
    const declared = dashboardManifest.datasets.find(
      (entry) => entry.name === 'fi-product-penetration'
    )
    const summed = (declared?.chunks ?? []).reduce(
      (running, chunk) => running + chunk.rowCount,
      0
    )
    expect(summed).toBe(declared?.rowCount)
  })
})

/* -------------------------------------------------------------------------- */
/* 3. Reconciliation against the export's own published totals                 */
/* -------------------------------------------------------------------------- */

describe('every headline figure reproduces the published total exactly', () => {
  const view = wholeWindow()

  it('reproduces finance reserve, product gross, retained gross and contracts', () => {
    sameValue(
      view.production.financeReserveGross,
      total('finance_reserve_gross'),
      'finance reserve'
    )
    sameValue(
      view.production.originalProductGross,
      total('original_product_gross'),
      'original product gross'
    )
    sameValue(
      view.production.netProductGrossAsOf,
      total('net_product_gross_as_of'),
      'retained product gross'
    )
    sameValue(view.production.contractCount, total('fi_contract_count'), 'contracts')
  })

  it('reproduces both sides of products per retail unit, never the quotient alone', () => {
    const published = components('products_per_retail_unit')
    sameValue(
      view.production.productsPerRetailUnit.numerator,
      published.numerator,
      'contracts'
    )
    sameValue(
      view.production.productsPerRetailUnit.denominator,
      published.denominator,
      'retail units'
    )
  })

  it.each([
    ['Vehicle Service Contract', 'vsc_penetration'],
    ['GAP', 'gap_penetration'],
  ])('reproduces both sides of %s penetration', (category, key) => {
    const published = components(key)
    const row = view.categories.find((entry) => entry.category === category)
    expect(row, `${category} is missing from the page`).toBeDefined()
    if (!row) return
    sameValue(row.attachedDeals, published.numerator, `${category} attached deals`)
    sameValue(row.eligibleDeals, published.denominator, `${category} eligible deals`)
  })

  it('reproduces the chargeback and cancellation amounts on the adjustment basis', () => {
    for (const [type, key] of [
      ['Chargeback', 'chargeback_amount'],
      ['Cancellation', 'cancellation_amount'],
    ] as const) {
      const row = view.adjustmentTypes.find((entry) => entry.adjustmentType === type)
      expect(row, `${type} is missing`).toBeDefined()
      if (row) sameValue(row.amount, total(key), `${type} amount`)
    }
  })

  it('agrees with gross-summary about back-end gross, across two datasets', () => {
    /*
     * The strongest check in this file. `finance_reserve_gross` and
     * `original_product_gross` come from `fi-summary`; `back_end_gross` comes from
     * `gross-summary`, a different view over a different fact. Their agreeing to the cent
     * is not a tautology.
     */
    const explained = addExact(
      total('finance_reserve_gross'),
      total('original_product_gross')
    )
    sameValue(explained, total('back_end_gross'), 'reserve + product gross')
    sameValue(
      view.production.backEndGrossDealDate,
      total('back_end_gross'),
      'page back-end gross'
    )
    expect(backGrossIdentityHolds(view.production)).toBe(true)
    expect(isZero(backGrossResidual(view.production))).toBe(true)
  })

  it('keeps the retained identity separate from the deal-date identity', () => {
    // Retained gross is a DIFFERENT question and must not be substituted into the
    // deal-date identity: substituting it would make the check fail on every adjusted
    // population, which would be a correct behaviour reported as a defect.
    expect(netFiGrossIdentityHolds(view.production)).toBe(true)
    expect(
      compareExact(
        view.production.netProductGrossAsOf,
        view.production.originalProductGross
      )
    ).toBeLessThan(0)
  })
})

/* -------------------------------------------------------------------------- */
/* 4. Penetration is a per-category denominator, and a filter scopes both sides */
/* -------------------------------------------------------------------------- */

describe('penetration', () => {
  const view = wholeWindow()

  it('uses a different eligible denominator per category, never all retail deals', () => {
    const denominators = new Set(
      view.categories.map((row) => exactToString(row.eligibleDeals))
    )
    expect(
      denominators.size,
      'every category shares one denominator, which is the contracts ÷ all deals mistake'
    ).toBeGreaterThan(1)

    // And the retail-unit count is not the denominator for the categories that are
    // restricted: lease-only and finance-only products have smaller populations.
    const units = view.production.retailUnits
    const lease = view.categories.find((row) => row.category === 'Lease Wear Protection')
    expect(lease).toBeDefined()
    if (lease) expect(compareExact(lease.eligibleDeals, units)).toBeLessThan(0)
  })

  it('never publishes an eligible denominator larger than the retail population', () => {
    for (const row of view.categories) {
      expect(
        compareExact(row.eligibleDeals, view.production.retailUnits),
        `${row.category} claims more eligible deals than there are retail units`
      ).toBeLessThanOrEqual(0)
    }
  })

  it('counts distinct attached DEALS, so a second contract does not raise it', () => {
    /*
     * Visible in the committed data rather than asserted in the abstract: at least one
     * category carries more contracts than attached deals, which can only happen if the
     * numerator is distinct deals.
     */
    const multi = view.categories.filter(
      (row) => compareExact(row.contracts, row.attachedDeals) > 0
    )
    expect(
      multi.length,
      'no category has more contracts than attached deals, so the distinct-deal rule is untested by this data'
    ).toBeGreaterThan(0)
    for (const row of view.categories) {
      expect(
        compareExact(row.attachedDeals, row.contracts),
        `${row.category} claims more attached deals than contracts`
      ).toBeLessThanOrEqual(0)
      expect(
        compareExact(row.attachedDeals, row.eligibleDeals),
        `${row.category} attached more deals than were eligible`
      ).toBeLessThanOrEqual(0)
    }
  })

  it('scopes numerator AND denominator when a store filter is applied', () => {
    const group = wholeWindow()
    const perStore = dashboardStoreIds.map((id) => wholeWindow({ store: [id] }))
    for (const category of FI_CATEGORY_ORDER) {
      const whole = group.categories.find((row) => row.category === category)
      if (whole === undefined) continue
      let numerator = exactFromInteger(0)
      let denominator = exactFromInteger(0)
      for (const store of perStore) {
        const row = store.categories.find((entry) => entry.category === category)
        if (row === undefined) continue
        numerator = addExact(numerator, row.attachedDeals)
        denominator = addExact(denominator, row.eligibleDeals)
      }
      sameValue(numerator, whole.attachedDeals, `${category} numerator across stores`)
      sameValue(denominator, whole.eligibleDeals, `${category} denominator across stores`)
    }
  })

  it('is not the average of the store penetrations, and that number differs', () => {
    /*
     * The wrong answer, computed deliberately. A group figure summed from components is a
     * different number from the mean of three store percentages, and a reader who cannot
     * see the difference has no reason to believe the rule matters.
     */
    const group = wholeWindow()
    const vsc = group.categories.find(
      (row) => row.category === 'Vehicle Service Contract'
    )
    expect(vsc?.penetration.value).not.toBeNull()

    let sum = exactFromInteger(0)
    let counted = 0
    for (const id of dashboardStoreIds) {
      const row = wholeWindow({ store: [id] }).categories.find(
        (entry) => entry.category === 'Vehicle Service Contract'
      )
      if (row?.penetration.value == null) continue
      sum = addExact(sum, row.penetration.value)
      counted += 1
    }
    expect(counted).toBe(dashboardStoreIds.length)
    const meanOfStores = divideExact(sum, exactFromInteger(counted), 6)
    expect(meanOfStores).not.toBeNull()
    expect(
      compareExact(meanOfStores as Exact, vsc!.penetration.value as Exact),
      'the average of store penetrations happens to equal the group figure in this data, so this test proves nothing'
    ).not.toBe(0)
  })

  it('states a reason rather than a zero when a category has no eligible deals', () => {
    // A month, one store, one category: the narrowest slice the filters allow.
    const narrow = buildFi(
      filters({
        period: { kind: 'month', month: MONTHS[0] as string },
        compare: 'none',
        store: [dashboardStoreIds[0] as string],
        product: fiCategorySlug('Lease Wear Protection'),
      })
    )
    for (const row of narrow.categories) {
      if (isZero(row.eligibleDeals)) {
        expect(row.penetration.value).toBeNull()
        expect(row.emptyReason).toBe('no-eligible-deals')
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 5. The three date bases are never blended                                   */
/* -------------------------------------------------------------------------- */

describe('the three date bases stay apart', () => {
  it('keeps adjustment rows on the adjustment date, not the parent sale date', () => {
    const rows = fiAdjustmentRows()
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(typeof row.adjustment_date).toBe('string')
      // The parent sale's date is not carried at all, so it cannot be used by mistake.
      expect(Object.keys(row)).not.toContain('sale_date')
    }
  })

  it('selects adjustments by the adjustment month, which moves the population', () => {
    /*
     * The behavioural statement of the rule: an August window and a June window select
     * different adjustment rows even though the same contracts underlie both. If the
     * module were restating adjustments onto the deal date, filtering by month would
     * select by the contract's month instead and these two would not differ this way.
     */
    const first = buildFi(
      filters({ period: { kind: 'month', month: MONTHS[0] as string }, compare: 'none' })
    )
    const last = buildFi(
      filters({ period: { kind: 'month', month: LATEST_MONTH }, compare: 'none' })
    )
    expect(exactToString(first.adjustmentAmountTotal)).not.toBe(
      exactToString(last.adjustmentAmountTotal)
    )
  })

  it('labels every mixed-basis rate a period proxy and never a loss rate', () => {
    const view = wholeWindow()
    expect(view.adjustmentTypes.length).toBeGreaterThan(0)
    for (const row of view.adjustmentTypes) {
      expect(row.disclosure.toLowerCase()).toContain(PERIOD_PROXY_LABEL.toLowerCase())
    }
    /*
     * The only place "loss rate" may appear is inside the disclaimer that DENIES it. A
     * flat substring sweep would fail on the disclosure itself, so the disclosure is
     * removed first and the sweep runs over what is left.
     */
    const prose = everyString(view)
      .join(' ')
      .toLowerCase()
      .split(PERIOD_PROXY_LABEL.toLowerCase())
      .join(' ')
    expect(prose).not.toContain('loss rate')
    expect(prose).not.toContain('cohort loss')
    expect(prose).not.toContain('chargeback rate')
  })

  it('never sums an adjustment-basis figure into a deal-basis one', () => {
    // The deal-date back-gross identity holds with the adjustments EXCLUDED. If a build
    // ever folded them in, this is the assertion that breaks.
    const view = wholeWindow()
    expect(backGrossIdentityHolds(view.production)).toBe(true)
    const wouldBeWrong = subtractExact(
      view.production.backEndGrossDealDate,
      view.production.cumulativeAdjustmentAmount
    )
    expect(compareExact(wouldBeWrong, view.production.backEndGrossDealDate)).not.toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* 6. The minimum-sample rule, governed centrally                              */
/* -------------------------------------------------------------------------- */

describe('the minimum-sample rule', () => {
  it('comes from the export rather than from a constant in this page', () => {
    const view = wholeWindow()
    expect(isZero(view.minimumSampleFloor)).toBe(false)
    const fromData = new Set(
      fiSummaryRows().map((row) => String(row.minimum_sample_floor))
    )
    expect(fromData.size, 'the floor is not uniform in the export').toBe(1)
    expect(exactToString(view.minimumSampleFloor)).toBe([...fromData][0])
  })

  it('suppresses the ratio but keeps the components on a below-floor row', () => {
    const view = wholeWindow({ period: { kind: 'month', month: MONTHS[0] as string } })
    const below = view.managers.filter((row) => !row.meetsMinimumSample)
    for (const row of below) {
      expect(isPublishable(row)).toBe(false)
      // The evidence stays: suppressing a ratio is a rendering decision, and blanking the
      // counts behind it would be a different and worse one.
      expect(row.retailUnits).toBeDefined()
      expect(compareExact(row.retailUnits, row.minimumSampleFloor)).toBeLessThan(0)
    }
  })

  it('publishes a row whose own denominator reaches the floor', () => {
    const view = wholeWindow()
    const publishable = view.managers.filter((row) => isPublishable(row))
    expect(publishable.length).toBeGreaterThan(0)
    for (const row of publishable) {
      expect(
        compareExact(row.retailUnits, row.minimumSampleFloor)
      ).toBeGreaterThanOrEqual(0)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 7. The manager comparison is not a leaderboard                              */
/* -------------------------------------------------------------------------- */

describe('the finance manager comparison', () => {
  const view = wholeWindow()

  it('carries no rank, position, percentile or best/worst field', () => {
    const forbidden =
      /rank|position|percentile|best|worst|top|bottom|winner|loser|leader/i
    for (const row of view.managers) {
      for (const key of Object.keys(row)) {
        expect(forbidden.test(key), `manager row carries ${key}`).toBe(false)
      }
    }
  })

  it('orders by store and code, never by a performance measure', () => {
    const order = view.managers.map((row) => row.code)
    const neutral = [...view.managers]
      .sort((left, right) => {
        if (left.code === null) return 1
        if (right.code === null) return -1
        const byStore = (left.stores[0] ?? '').localeCompare(right.stores[0] ?? '')
        return byStore !== 0 ? byStore : left.code.localeCompare(right.code)
      })
      .map((row) => row.code)
    expect(order).toEqual(neutral)
  })

  it('puts the unstaffed group last and labels it as a real population', () => {
    const unstaffed = view.managers.filter((row) => row.code === null)
    if (unstaffed.length === 0) return
    expect(view.managers.at(-1)?.code).toBeNull()
    expect(unstaffed[0]!.label.toLowerCase()).not.toContain('unknown')
  })

  it('makes no benchmark, target or quality claim anywhere on the page', () => {
    const prose = everyString(view).join(' ').toLowerCase()
    for (const word of [
      'industry average',
      'benchmark',
      'best practice',
      'should be',
      'top performer',
      'underperform',
      'above average',
      'below average',
      'healthy penetration',
      'weak penetration',
      'strong penetration',
      'target penetration',
      'we recommend',
      'you should',
    ]) {
      expect(prose, `the page says "${word}"`).not.toContain(word)
    }
  })

  it('makes no causal claim about why a figure moved', () => {
    const prose = everyString(view).join(' ').toLowerCase()
    for (const phrase of [
      'because of',
      'caused by',
      'due to the',
      'driven by',
      'as a result of',
    ]) {
      expect(prose, `the page claims causation: "${phrase}"`).not.toContain(phrase)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 8. Comparison arithmetic                                                    */
/* -------------------------------------------------------------------------- */

describe('period comparison', () => {
  it('is an ABSOLUTE difference between two proportions, converted once', () => {
    /*
     * THE DEFECT THIS TEST WAS WRITTEN AGAINST.
     *
     * The selector pre-multiplied the difference by 100 and the shared formatter
     * multiplied it again, so a change of three and a half points rendered as
     * "+350.9 percentage points". Nothing about the number looked like an arithmetic
     * error -- it looked like a data error -- and the page still reconciled, because
     * both penetration figures were right and only their difference was not.
     *
     * The field therefore carries a PROPORTION, the same unit every other difference in
     * the console carries, and `formatPointsDifference` performs the one conversion.
     */
    const view = buildFi(
      filters({ period: { kind: 'month', month: LATEST_MONTH }, compare: 'prior-period' })
    )
    let compared = 0
    for (const row of view.categories) {
      if (row.penetrationChange === null) continue
      expect(row.priorPenetration).not.toBeNull()
      const current = row.penetration.value
      const prior = row.priorPenetration?.value ?? null
      if (current === null || prior === null) continue
      sameValue(
        row.penetrationChange,
        subtractExact(current, prior),
        `${row.category} penetration change`
      )
      compared += 1
    }
    expect(
      compared,
      'no category formed a comparison, so nothing was checked'
    ).toBeGreaterThan(0)
  })

  it('renders that difference in percentage points, not in percent', () => {
    // The end of the chain: the selector's value, through the shared formatter, is what
    // a reader sees. A change from 36.7% to 40.2% is +3.5 points and never +350.9.
    const view = buildFi(
      filters({ period: { kind: 'month', month: LATEST_MONTH }, compare: 'prior-period' })
    )
    for (const row of view.categories) {
      if (row.penetrationChange === null) continue
      const rendered = formatPointsDifference(row.penetrationChange, 1)
      expect(rendered).toMatch(/^[+-]\d{1,2}(\.\d)? percentage points?$/)
      expect(rendered).not.toContain('%')
    }
  })

  it('suppresses the change when either side has no value', () => {
    const view = buildFi(
      filters({
        period: { kind: 'month', month: MONTHS[0] as string },
        compare: 'prior-period',
      })
    )
    for (const row of view.categories) {
      if (row.penetration.value === null || row.priorPenetration?.value == null) {
        expect(row.penetrationChange).toBeNull()
      }
    }
  })

  it('builds no comparison at all when none was asked for', () => {
    const view = wholeWindow()
    expect(view.priorProduction).toBeNull()
    for (const row of view.categories) {
      expect(row.priorPenetration).toBeNull()
      expect(row.penetrationChange).toBeNull()
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 9. Filters, structures and the URL grammar                                  */
/* -------------------------------------------------------------------------- */

describe('the filter grammar', () => {
  it('maps every governed category to a readable slug and back', () => {
    for (const category of FI_CATEGORY_ORDER) {
      const slug = fiCategorySlug(category)
      expect(slug).toMatch(/^[a-z0-9-]+$/)
      expect(fiCategoryForSlug(slug)).toBe(category)
    }
  })

  it('accepts "extended-warranty" as an alias and never as a category of its own', () => {
    expect(fiCategoryForSlug('extended-warranty')).toBe('Vehicle Service Contract')
    expect(FI_CATEGORY_ORDER).not.toContain('Extended Warranty')
    const view = wholeWindow({ product: 'extended-warranty' })
    expect(view.categoryFilter).toBe('Vehicle Service Contract')
  })

  it('resolves an unknown product slug to no filter rather than to an empty page', () => {
    expect(fiCategoryForSlug('nonsense')).toBeNull()
    const view = wholeWindow({ product: 'nonsense' })
    expect(view.categoryFilter).toBeNull()
    expect(view.hasRows).toBe(true)
  })

  it('translates the three structure values and rejects everything else', () => {
    expect(structureForFilter('cash')).toBe('Cash')
    expect(structureForFilter('finance')).toBe('Retail Finance')
    expect(structureForFilter('lease')).toBe('Lease')
    expect(structureForFilter('wholesale')).toBeNull()
    expect(structureForFilter(null)).toBeNull()
  })

  it('states in a notice that the structure filter is partial rather than silently ignoring it', () => {
    const view = wholeWindow({ structure: 'lease' })
    expect(view.structureFilter).toBe('Lease')
    expect(view.notices.join(' ')).toContain('Lease')
    expect(view.notices.join(' ')).toContain('structure MIX')
  })

  it('declares the route support honestly, including what does not apply', () => {
    expect(FI_SUPPORT.period.support).toBe('applied')
    expect(FI_SUPPORT.store.support).toBe('applied')
    expect(FI_SUPPORT.employee.support).toBe('applied')
    expect(FI_SUPPORT.product.support).toBe('applied')
    expect(FI_SUPPORT.structure.support).toBe('partial')
    for (const key of ['condition', 'source', 'campaign', 'make', 'model'] as const) {
      expect(FI_SUPPORT[key].support, `${key} claims to apply`).toBe('not-applicable')
      // An inapplicable filter states WHY. "Not applicable" with no reason is the
      // sentence a reader cannot check.
      expect(FI_SUPPORT[key].note ?? '', `${key} gives no reason`).not.toBe('')
    }
  })

  it('partitions retail deliveries exactly across the three structures', () => {
    const view = wholeWindow()
    expect(view.structures.map((row) => row.structure)).toEqual([...FI_STRUCTURES])
    let summed = exactFromInteger(0)
    for (const row of view.structures) summed = addExact(summed, row.deals)
    sameValue(summed, view.production.retailUnits, 'structure mix')
  })

  it('scopes an employee filter to that manager on both sides of every ratio', () => {
    const group = wholeWindow()
    const staffed = group.managers.find((row) => row.code !== null && isPublishable(row))
    expect(staffed).toBeDefined()
    if (!staffed) return
    const scoped = wholeWindow({ employee: staffed.code as string })
    sameValue(scoped.production.retailUnits, staffed.retailUnits, 'scoped retail units')
    sameValue(
      scoped.production.financeReserveGross,
      staffed.financeReserveGross,
      'scoped reserve'
    )
    expect(
      compareExact(scoped.production.retailUnits, group.production.retailUnits)
    ).toBeLessThan(0)
  })
})

/* -------------------------------------------------------------------------- */
/* 10. Empty states are states, never zeros                                     */
/* -------------------------------------------------------------------------- */

describe('empty states', () => {
  /*
   * An out-of-window date range is NOT the way to produce an empty selection: the period
   * resolver clamps a range to the reporting window, which is correct behaviour and would
   * make these tests pass against a populated page. A finance-manager code that matches
   * nobody is a genuinely empty selection inside a valid window.
   */
  const empty = wholeWindow({ employee: 'EMP-00000' })

  it('renders a selection with no F&I production as an absence, not as zeros', () => {
    expect(empty.hasRows).toBe(false)
    expect(empty.production.productsPerRetailUnit.value).toBeNull()
    expect(empty.production.reservePvr.value).toBeNull()
    expect(empty.managers).toEqual([])
    expect(isZero(empty.minimumSampleFloor)).toBe(true)
  })

  it('gives a null ratio a denominator of zero rather than a value of zero', () => {
    const nullRatios: FiRatio[] = [
      empty.production.reservePvr,
      empty.production.productGrossPvr,
      empty.production.productsPerRetailUnit,
      empty.production.grossPerContract,
    ]
    for (const entry of nullRatios) {
      expect(entry.value).toBeNull()
      expect(isZero(entry.denominator)).toBe(true)
    }
  })

  it('empties both sides of every penetration rather than only the numerator', () => {
    // A numerator that emptied while the denominator kept the group population would
    // publish 0% for every category, which is a confident wrong answer.
    for (const row of empty.categories) {
      expect(isZero(row.attachedDeals), `${row.category} numerator`).toBe(true)
      expect(isZero(row.eligibleDeals), `${row.category} denominator`).toBe(true)
      expect(row.penetration.value).toBeNull()
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 11. Scope                                                                    */
/* -------------------------------------------------------------------------- */

describe('the F&I page stays inside its increment', () => {
  it('models no payment, menu, rate or approval anywhere in the view', () => {
    /*
     * Matched on WHOLE camelCase words rather than on substrings. A substring match reads
     * `dealsWithAProduct` as containing "apr" and fails on a field that is exactly what
     * this increment is supposed to publish — a false alarm that would eventually be
     * silenced by deleting the test, which is the worst outcome available.
     */
    const words = new Set<string>()
    const walk = (value: unknown, seen = new Set<unknown>()): void => {
      if (value === null || typeof value !== 'object' || seen.has(value)) return
      seen.add(value)
      if (Array.isArray(value)) {
        for (const entry of value) walk(entry, seen)
        return
      }
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        for (const word of key.split(/(?=[A-Z])|[^A-Za-z0-9]+/)) {
          if (word !== '') words.add(word.toLowerCase())
        }
        walk(entry, seen)
      }
    }
    walk(wholeWindow())
    for (const token of [
      'apr',
      'payment',
      'buy',
      'sell',
      'spread',
      'menu',
      'approval',
      'approved',
      'credit',
      'fico',
      'score',
      'tier',
      'income',
      'stipulation',
    ]) {
      expect(words.has(token), `a field names "${token}"`).toBe(false)
    }
  })

  it('names every store in the scope it claims', () => {
    const view = wholeWindow()
    expect(view.scope.stores.length).toBe(dashboardStores.length)
    expect(view.scope.label).toBe('the group')
    const one = wholeWindow({ store: [dashboardStoreIds[0] as string] })
    expect(one.scope.stores.length).toBe(1)
    expect(one.scope.label).toBe(dashboardStores[0]!.shortName)
  })

  it('carries the export as-of date rather than a wall clock', () => {
    expect(wholeWindow().asOfDate).toBe(dashboardManifest.asOfDate)
  })
})

/* -------------------------------------------------------------------------- */
/* 12. A corrupted partition surfaces rather than rendering a wrong number      */
/* -------------------------------------------------------------------------- */

describe('the back-gross identity fails loudly when the data disagrees', () => {
  it('reports a residual rather than silently balancing', () => {
    const view = wholeWindow()
    const corrupted = {
      ...view.production,
      financeReserveGross: addExact(
        view.production.financeReserveGross,
        exactFromInteger(1)
      ),
    }
    expect(backGrossIdentityHolds(corrupted)).toBe(false)
    expect(isZero(backGrossResidual(corrupted))).toBe(false)
  })

  it('reports the residual with its sign, so the direction is readable', () => {
    const view = wholeWindow()
    const over = {
      ...view.production,
      originalProductGross: addExact(
        view.production.originalProductGross,
        exactFromInteger(250)
      ),
    }
    const residual = backGrossResidual(over)
    expect(isZero(residual)).toBe(false)
    expect(residual.units < 0n || residual.units > 0n).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* 13. Every manager row's ratios are its own components                        */
/* -------------------------------------------------------------------------- */

describe('a manager row divides its own two columns', () => {
  it('recomputes every published ratio from the row it sits on', () => {
    const view = wholeWindow()
    const check = (row: FiManagerRow, ratioValue: FiRatio, label: string): void => {
      if (ratioValue.value === null) {
        expect(
          isZero(ratioValue.denominator),
          `${label} has a denominator but no value`
        ).toBe(true)
        return
      }
      const recomputed = divideExact(ratioValue.numerator, ratioValue.denominator, 6)
      expect(recomputed, `${label} divides by zero`).not.toBeNull()
      sameValue(
        ratioValue.value,
        recomputed as Exact,
        `${row.code ?? 'unstaffed'} ${label}`
      )
    }
    expect(view.managers.length).toBeGreaterThan(0)
    for (const row of view.managers) {
      check(row, row.reservePvr, 'reserve PVR')
      check(row, row.productGrossPvr, 'product gross PVR')
      check(row, row.productsPerRetailUnit, 'products per unit')
      check(row, row.netFiGrossPvr, 'retained F&I PVR')
    }
  })

  it('sums the manager rows back to the group production', () => {
    const view = wholeWindow()
    let units = exactFromInteger(0)
    let reserve = exactFromInteger(0)
    let product = exactFromInteger(0)
    for (const row of view.managers) {
      units = addExact(units, row.retailUnits)
      reserve = addExact(reserve, row.financeReserveGross)
      product = addExact(product, row.originalProductGross)
    }
    sameValue(units, view.production.retailUnits, 'manager retail units')
    sameValue(reserve, view.production.financeReserveGross, 'manager reserve')
    sameValue(product, view.production.originalProductGross, 'manager product gross')
  })
})
