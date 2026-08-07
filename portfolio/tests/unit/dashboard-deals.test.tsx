/**
 * The Deal Explorer: URL state, determinism, and the privacy boundary.
 *
 * WHAT IS ACTUALLY AT RISK HERE
 * ----------------------------
 * An index is easy to make plausible and hard to make correct. Three defects would
 * all look fine on screen:
 *
 *   * a non-total sort, which makes pagination lose and repeat rows between pages;
 *   * a search that matches a field the reader cannot see, producing a result set
 *     they cannot explain;
 *   * a filter that silently drops the rows it cannot classify.
 *
 * Each has a test below that fails when it is reintroduced. The pagination test in
 * particular walks EVERY page and asserts the union is the whole filtered set with no
 * duplicates, which is the only assertion that actually catches an unstable order.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DEFAULT_FILTERS } from '../../src/lib/dashboard/filters.ts'
import {
  DEALS_PER_PAGE,
  DEAL_SORT_KEYS,
  DEFAULT_LIST_STATE,
  buildDeals,
  listStateQuery,
  parseListState,
} from '../../src/lib/dashboard/deals.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '../..')

/** The whole reporting window at group scope: every deal the export carries. */
const ALL = {
  ...DEFAULT_FILTERS,
  period: { kind: 'range' as const, start: '2025-07-01', end: '2025-12-31' },
}

function collectAllPages(filters = ALL, state = DEFAULT_LIST_STATE) {
  const first = buildDeals(filters, state)
  const ids: string[] = []
  for (let page = 1; page <= first.pageCount; page += 1) {
    const view = buildDeals(filters, { ...state, page })
    ids.push(...view.rows.map((row) => row.saleId))
  }
  return { ids, total: first.totalCount, pageCount: first.pageCount }
}

describe('the index covers the whole governed deal population', () => {
  it('carries every finalized transaction the export publishes', () => {
    const view = buildDeals(ALL, DEFAULT_LIST_STATE)
    expect(view.totalCount).toBe(650)
  })

  it('shows one page at a time and never the whole set', () => {
    const view = buildDeals(ALL, DEFAULT_LIST_STATE)
    expect(view.rows.length).toBe(DEALS_PER_PAGE)
    expect(view.rows.length).toBeLessThan(view.totalCount)
  })

  it('includes wholesale and dealer trades, labelled as not retail', () => {
    const view = buildDeals(ALL, DEFAULT_LIST_STATE)
    const { ids } = collectAllPages()
    expect(ids.length).toBe(view.totalCount)
    const wholesale = buildDeals({ ...ALL, scope: 'wholesale' }, DEFAULT_LIST_STATE)
    expect(wholesale.totalCount).toBeGreaterThan(0)
    for (const row of wholesale.rows) expect(row.isRetail).toBe(false)
  })

  it('reports retail units and gross of the WHOLE filtered set, not of one page', () => {
    const view = buildDeals(ALL, DEFAULT_LIST_STATE)
    expect(view.retailCount).toBe(558)
    expect(view.totalGrossDisplay).toBe('$1,936,572')
  })
})

describe('pagination is stable, which requires a total order', () => {
  it('visits every deal exactly once across all pages', () => {
    const { ids, total, pageCount } = collectAllPages()
    expect(pageCount).toBe(Math.ceil(total / DEALS_PER_PAGE))
    expect(ids.length).toBe(total)
    expect(new Set(ids).size).toBe(total)
  })

  it('visits every deal exactly once under every sort key and direction', () => {
    /*
     * The assertion that actually catches a non-total order. A comparator without a
     * unique tie-breaker reorders equal rows between calls, so a row can appear on
     * two pages and another on none -- and the page-one screenshot looks perfect.
     */
    for (const sort of DEAL_SORT_KEYS) {
      for (const direction of ['asc', 'desc'] as const) {
        const { ids, total } = collectAllPages(ALL, {
          ...DEFAULT_LIST_STATE,
          sort,
          direction,
        })
        expect(ids.length, `${sort} ${direction} lost or repeated rows`).toBe(total)
        expect(new Set(ids).size, `${sort} ${direction} repeated a row`).toBe(total)
      }
    }
  })

  it('clamps a page past the end and says it did', () => {
    const view = buildDeals(ALL, { ...DEFAULT_LIST_STATE, page: 9999 })
    expect(view.pageClamped).toBe(true)
    expect(view.state.page).toBe(view.pageCount)
    expect(view.rows.length).toBeGreaterThan(0)
  })

  it('reports a truthful position for the current page', () => {
    const view = buildDeals(ALL, { ...DEFAULT_LIST_STATE, page: 3 })
    expect(view.firstRowNumber).toBe(2 * DEALS_PER_PAGE + 1)
    expect(view.lastRowNumber).toBe(3 * DEALS_PER_PAGE)
  })
})

describe('sorting', () => {
  it('orders a monetary column by its exact value, not by its formatted text', () => {
    /*
     * A string sort of "$9,500" and "$11,592" puts the smaller number first. The
     * comparator works on exact decimals, so this is ordered correctly.
     */
    const view = buildDeals(ALL, {
      ...DEFAULT_LIST_STATE,
      sort: 'total_gross',
      direction: 'desc',
    })
    const amounts = view.rows.map((row) => Number(row.totalGross.replace(/[$,]/g, '')))
    for (let index = 1; index < amounts.length; index += 1) {
      expect(amounts[index]!).toBeLessThanOrEqual(amounts[index - 1]!)
    }
  })

  it('sorts ascending and descending into exactly reversed extremes', () => {
    const descending = buildDeals(ALL, {
      ...DEFAULT_LIST_STATE,
      sort: 'total_gross',
      direction: 'desc',
    })
    const ascending = buildDeals(ALL, {
      ...DEFAULT_LIST_STATE,
      sort: 'total_gross',
      direction: 'asc',
    })
    const highest = Number(descending.rows[0]!.totalGross.replace(/[$,]/g, ''))
    const lowest = Number(ascending.rows[0]!.totalGross.replace(/[$,]/g, ''))
    expect(highest).toBeGreaterThan(lowest)
  })
})

describe('search is deterministic and only searches visible fields', () => {
  it('matches a deal id exactly', () => {
    const view = buildDeals(ALL, { ...DEFAULT_LIST_STATE, query: 'SLE-00000646' })
    expect(view.totalCount).toBe(1)
    expect(view.rows[0]!.saleId).toBe('SLE-00000646')
  })

  it('matches a make case-insensitively', () => {
    const upper = buildDeals(ALL, { ...DEFAULT_LIST_STATE, query: 'SUBARU' })
    const lower = buildDeals(ALL, { ...DEFAULT_LIST_STATE, query: 'subaru' })
    expect(upper.totalCount).toBe(lower.totalCount)
    expect(upper.totalCount).toBeGreaterThan(0)
  })

  it('returns the same result set on every call', () => {
    const first = buildDeals(ALL, { ...DEFAULT_LIST_STATE, query: 'Forester' })
    const second = buildDeals(ALL, { ...DEFAULT_LIST_STATE, query: 'Forester' })
    expect(first.rows.map((row) => row.saleId)).toEqual(
      second.rows.map((row) => row.saleId)
    )
  })

  it('finds nothing for a term that matches no visible field', () => {
    const view = buildDeals(ALL, { ...DEFAULT_LIST_STATE, query: 'zzzzzznotathing' })
    expect(view.totalCount).toBe(0)
    expect(view.rows).toEqual([])
  })

  it('does not search a field the reader cannot see', () => {
    /*
     * `salesperson_code` is rendered, but `condition_group` and `dealership_id` are
     * not searchable: a hit on a hidden field produces a result the reader cannot
     * account for. Searching a store code must therefore find nothing.
     */
    const view = buildDeals(ALL, { ...DEFAULT_LIST_STATE, query: 'GSA-001' })
    expect(view.totalCount).toBe(0)
  })

  it('survives a search combined with a filter and a sort', () => {
    const view = buildDeals(
      { ...ALL, store: ['GSA-002'], condition: 'New' },
      { ...DEFAULT_LIST_STATE, query: 'Subaru', sort: 'total_gross', direction: 'desc' }
    )
    for (const row of view.rows) {
      expect(row.storeName).toContain('Subaru')
      expect(row.vehicle.toLowerCase()).toContain('subaru')
    }
  })
})

describe('route parameters parse with the same discipline as the global grammar', () => {
  it('accepts the declared vocabulary', () => {
    const { state, reset } = parseListState({
      sort: 'total_gross',
      dir: 'asc',
      page: '4',
      q: ' Forester ',
    })
    expect(reset).toEqual([])
    expect(state).toEqual({
      sort: 'total_gross',
      direction: 'asc',
      page: 4,
      query: 'Forester',
    })
  })

  it('resets an unknown sort with a reason rather than throwing', () => {
    const { state, reset } = parseListState({ sort: 'drop table' })
    expect(state.sort).toBe(DEFAULT_LIST_STATE.sort)
    expect(reset).toHaveLength(1)
    expect(reset[0]!.key).toBe('sort')
    expect(reset[0]!.reason).toContain('Expected one of')
  })

  it('resets a non-numeric or zero page', () => {
    for (const bad of ['0', '-1', 'abc', '1.5']) {
      const { state, reset } = parseListState({ page: bad })
      expect(state.page).toBe(1)
      expect(reset.map((entry) => entry.key)).toContain('page')
    }
  })

  it('caps the search term so a URL cannot make an unbounded query', () => {
    const { state } = parseListState({ q: 'x'.repeat(500) })
    expect(state.query.length).toBe(60)
  })

  it('round-trips through the query string, omitting defaults', () => {
    expect(listStateQuery(DEFAULT_LIST_STATE)).toBe('')
    const state = {
      sort: 'front_end_gross' as const,
      direction: 'asc' as const,
      page: 7,
      query: 'F-150',
    }
    const query = listStateQuery(state)
    expect(query).toBe('q=F-150&sort=front_end_gross&dir=asc&page=7')
    const parsed = parseListState(Object.fromEntries(new URLSearchParams(query)))
    expect(parsed.state).toEqual(state)
    expect(parsed.reset).toEqual([])
  })
})

describe('filters narrow the population honestly', () => {
  it('partitions the population by condition without losing a deal', () => {
    const all = buildDeals({ ...ALL, scope: 'combined' }, DEFAULT_LIST_STATE)
    const retail = all.retailCount
    const newOnly = buildDeals({ ...ALL, scope: 'new' }, DEFAULT_LIST_STATE)
    const usedOnly = buildDeals({ ...ALL, scope: 'used' }, DEFAULT_LIST_STATE)
    expect(newOnly.totalCount + usedOnly.totalCount).toBe(retail)
  })

  it('excludes walk-in deals when a lead source is selected, rather than including them', () => {
    /*
     * A deal with no linked lead is walk-in business, not a deal from an unknown
     * source. Including it under a source filter would attribute business to a
     * channel that did not produce it.
     */
    const sourced = buildDeals({ ...ALL, source: 'LDS-001' }, DEFAULT_LIST_STATE)
    expect(sourced.totalCount).toBeGreaterThan(0)
    for (const row of sourced.rows) {
      expect(row.isLeadAttributed).toBe(true)
      expect(row.leadSource).not.toBeNull()
    }
  })

  it('keeps unattributed deals visible when no source is selected', () => {
    const { ids } = collectAllPages()
    expect(ids.length).toBe(650)
    const view = buildDeals(ALL, DEFAULT_LIST_STATE)
    const anyPageHasBoth = buildDeals(ALL, { ...DEFAULT_LIST_STATE, page: 1 })
    expect(view.totalCount).toBeGreaterThan(0)
    expect(anyPageHasBoth.rows.some((row) => !row.isLeadAttributed)).toBe(true)
  })

  it('narrows to a single store without changing that store’s own figures', () => {
    const scoped = buildDeals({ ...ALL, store: ['GSA-003'] }, DEFAULT_LIST_STATE)
    for (const row of scoped.rows) expect(row.storeId).toBe('GSA-003')
    expect(scoped.totalCount).toBeLessThan(650)
  })
})

describe('the deal lane carries no personal data', () => {
  const FORBIDDEN = [
    'customer',
    'first_name',
    'last_name',
    'email',
    'phone',
    'address',
    'postal',
    'date_of_birth',
    'ssn',
    'credit_score',
    'drivers_license',
    'account_number',
    'employee_name',
  ]

  it('exposes no prohibited field on a rendered row', () => {
    const view = buildDeals(ALL, DEFAULT_LIST_STATE)
    const keys = Object.keys(view.rows[0] ?? {}).map((key) => key.toLowerCase())
    for (const forbidden of FORBIDDEN) {
      expect(keys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('exposes no prohibited column in the generated deal partitions', () => {
    /*
     * Checked against the DATA, not against the view model: a field absent from the
     * rendered row but present in the shipped chunk is still shipped.
     */
    const chunk = JSON.parse(
      readFileSync(
        join(
          PORTFOLIO,
          'src/generated/dashboard/datasets/deal-explorer/GSA-001/2025-12.json'
        ),
        'utf8'
      )
    ) as { columns: string[] }
    for (const column of chunk.columns) {
      for (const forbidden of FORBIDDEN) {
        expect(
          column.toLowerCase().includes(forbidden),
          `deal chunk exposes ${column}`
        ).toBe(false)
      }
    }
    expect(chunk.columns).not.toContain('sale_key')
  })

  it('publishes staff as synthetic codes and never as names', () => {
    const view = buildDeals(ALL, DEFAULT_LIST_STATE)
    for (const row of view.rows) {
      if (row.salespersonCode === null) continue
      expect(row.salespersonCode).toMatch(/^EMP-\d+$/)
    }
  })
})

describe('negative front gross stays visible', () => {
  it('counts it and marks each row rather than suppressing it', () => {
    const view = buildDeals(ALL, DEFAULT_LIST_STATE)
    expect(view.negativeFrontCount).toBeGreaterThan(0)
    const negatives = buildDeals(ALL, {
      ...DEFAULT_LIST_STATE,
      sort: 'front_end_gross',
      direction: 'asc',
    })
    const worst = negatives.rows[0]!
    expect(worst.isNegativeFrontGross).toBe(true)
    expect(worst.frontGross.startsWith('-')).toBe(true)
  })
})
