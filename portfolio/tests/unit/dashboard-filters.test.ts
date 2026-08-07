/**
 * The global URL filter contract (`DASH.2-02`).
 *
 * The grammar in `INFORMATION_ARCHITECTURE.md` §6 is thirteen parameters wide and
 * the Executive Overview can act on five of them. This suite covers all thirteen,
 * because the grammar is a console-wide contract rather than a property of the
 * first page to use it: a parameter that parses today and is spelled differently by
 * `/dashboard/inventory` tomorrow is how a copied URL stops reproducing a view.
 *
 * Four things are asserted that a round-trip test alone would not catch:
 *
 *   - Canonical ORDER, not just canonical content. Two equivalent states must
 *     serialize to the same bytes, or "the link reproduces the view" is not
 *     checkable.
 *   - Every rejection carries a reason a reader can act on, because IA §6 requires
 *     the notice to be visible rather than silent.
 *   - An unknown key is ignored WITHOUT a notice, and an invalid value is replaced
 *     WITH one. They are different failures and the contract treats them differently.
 *   - Nothing is persisted anywhere but the URL, asserted by reading the module's
 *     own source for the storage APIs it must never touch.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  COMPARE_MODES,
  CONDITION_VALUES,
  DEFAULT_FILTERS,
  EXECUTIVE_OVERVIEW_SUPPORT,
  FILTER_KEYS,
  SCOPE_VALUES,
  STRUCTURE_VALUES,
  activeFilterChips,
  filtersHref,
  isDefaultFilters,
  isRealDate,
  parseFilters,
  serializeFilters,
  withoutFilter,
  type DashboardFilters,
} from '../../src/lib/dashboard/filters.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '../..')

const STORES = ['GSA-001', 'GSA-002', 'GSA-003']
const SOURCES = ['LDS-001', 'LDS-002', 'LDS-016']

/** Parse a query string exactly as the route does. */
function parse(search: string) {
  return parseFilters(new URLSearchParams(search), {
    knownStores: STORES,
    knownSources: SOURCES,
  })
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

describe('the default state', () => {
  it('is what an empty query string produces', () => {
    const { filters, reset, ignored } = parse('')
    expect(filters).toEqual(DEFAULT_FILTERS)
    expect(reset).toEqual([])
    expect(ignored).toEqual([])
  })

  it('serializes to nothing at all, so "Reset" is a link to the bare route', () => {
    expect(serializeFilters(DEFAULT_FILTERS)).toBe('')
    expect(filtersHref('/dashboard', DEFAULT_FILTERS)).toBe('/dashboard')
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true)
  })

  it('leaves the period to the data rather than hard-coding a month', () => {
    // `default` is a member of the union, not a null: which month is "latest full"
    // is a property of the export's calendar and is resolved in `periods.ts`.
    expect(DEFAULT_FILTERS.period).toEqual({ kind: 'default' })
  })

  it('compares against the prior period unless told otherwise', () => {
    expect(DEFAULT_FILTERS.compare).toBe('prior-period')
  })

  it('treats an absent store list as the whole group', () => {
    expect(DEFAULT_FILTERS.store).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The full grammar                                                            */
/* -------------------------------------------------------------------------- */

describe('the full IA §6 parameter vocabulary', () => {
  it('declares exactly the thirteen parameters the information architecture names', () => {
    expect([...FILTER_KEYS]).toEqual([
      'period',
      'compare',
      'store',
      'scope',
      'dept',
      'employee',
      'source',
      'campaign',
      'make',
      'model',
      'condition',
      'structure',
      'product',
    ])
  })

  it('parses every one of them from a single URL', () => {
    const { filters, reset, ignored } = parse(
      'period=2025-11&compare=prior-year&store=GSA-002,GSA-001&scope=used&dept=SALES' +
        '&employee=EMP-00042&source=LDS-002&campaign=CMP-007&make=Chevrolet&model=Silverado' +
        '&condition=New&structure=finance&product=vsc'
    )
    expect(reset).toEqual([])
    expect(ignored).toEqual([])
    expect(filters).toEqual({
      period: { kind: 'month', month: '2025-11' },
      compare: 'prior-year',
      // Sorted, so `GSA-002,GSA-001` and `GSA-001,GSA-002` are one state.
      store: ['GSA-001', 'GSA-002'],
      scope: 'used',
      dept: 'SALES',
      employee: 'EMP-00042',
      source: 'LDS-002',
      campaign: 'CMP-007',
      make: 'Chevrolet',
      model: 'Silverado',
      condition: 'New',
      structure: 'finance',
      product: 'vsc',
    })
  })

  it('accepts every enumerated value the IA lists', () => {
    for (const mode of COMPARE_MODES) {
      expect(parse(`compare=${mode}`).filters.compare).toBe(mode)
    }
    for (const value of SCOPE_VALUES) {
      expect(parse(`scope=${value}`).filters.scope).toBe(value)
    }
    for (const value of CONDITION_VALUES) {
      expect(parse(`condition=${value}`).filters.condition).toBe(value)
    }
    for (const value of STRUCTURE_VALUES) {
      expect(parse(`structure=${value}`).filters.structure).toBe(value)
    }
  })

  it('parses all four period forms', () => {
    expect(parse('period=2025-08').filters.period).toEqual({
      kind: 'month',
      month: '2025-08',
    })
    expect(parse('period=2025-11-15..2025-12-15').filters.period).toEqual({
      kind: 'range',
      start: '2025-11-15',
      end: '2025-12-15',
    })
    expect(parse('period=mtd').filters.period).toEqual({ kind: 'mtd' })
    expect(parse('period=last-30d').filters.period).toEqual({ kind: 'last-30d' })
  })
})

/* -------------------------------------------------------------------------- */
/* Canonical serialization and round trip                                      */
/* -------------------------------------------------------------------------- */

describe('serialization is canonical', () => {
  it('emits parameters in the declared order regardless of input order', () => {
    const scrambled = parse('condition=New&store=GSA-003&compare=none&period=2025-09')
    expect(serializeFilters(scrambled.filters)).toBe(
      'period=2025-09&compare=none&store=GSA-003&condition=New'
    )
  })

  it('produces identical bytes for two equivalent states', () => {
    const a = parse('store=GSA-003,GSA-001&period=2025-10')
    const b = parse('period=2025-10&store=GSA-001,GSA-003,GSA-001')
    expect(serializeFilters(a.filters)).toBe(serializeFilters(b.filters))
  })

  it('omits every parameter that is at its default', () => {
    const { filters } = parse('compare=prior-period&scope=combined&store=')
    expect(serializeFilters(filters)).toBe('')
  })

  it('round-trips: parse, serialize, parse again, same state', () => {
    const cases = [
      '',
      'period=2025-07',
      'period=mtd',
      'period=last-30d',
      'period=2025-07-01..2025-07-31',
      'compare=none',
      'compare=prior-year&store=GSA-001',
      'store=GSA-001,GSA-002,GSA-003',
      'scope=wholesale&condition=Certified',
      'dept=FI&employee=EMP-00001&source=LDS-016&campaign=CMP-001',
      'make=Subaru&model=Outback&structure=lease&product=gap',
    ]
    for (const search of cases) {
      const first = parse(search)
      const serialized = serializeFilters(first.filters)
      const second = parse(serialized)
      expect(second.filters, `round trip of "${search}"`).toEqual(first.filters)
      expect(serializeFilters(second.filters)).toBe(serialized)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Rejection                                                                   */
/* -------------------------------------------------------------------------- */

describe('invalid values fall back with a visible reason', () => {
  it('rejects a period that is not one of the four forms', () => {
    const { filters, reset } = parse('period=yesterday')
    expect(filters.period).toEqual(DEFAULT_FILTERS.period)
    expect(reset).toHaveLength(1)
    expect(reset[0]?.key).toBe('period')
    expect(reset[0]?.received).toBe('yesterday')
    expect(reset[0]?.reason).toContain('2025-12')
  })

  it('rejects a date that matches the shape but is not a day that exists', () => {
    expect(isRealDate('2025-02-30')).toBe(false)
    expect(isRealDate('2024-02-29')).toBe(true)
    expect(isRealDate('2025-02-29')).toBe(false)
    const { filters, reset } = parse('period=2025-02-29..2025-03-01')
    expect(filters.period).toEqual(DEFAULT_FILTERS.period)
    expect(reset[0]?.reason).toContain('not a date that exists')
  })

  it('rejects a range that ends before it starts', () => {
    const { reset } = parse('period=2025-12-31..2025-12-01')
    expect(reset[0]?.reason).toContain('starts after it ends')
  })

  it('rejects a comparison mode outside the enumeration', () => {
    const { filters, reset } = parse('compare=sideways')
    expect(filters.compare).toBe('prior-period')
    expect(reset[0]?.reason).toContain('prior-period, prior-year, none')
  })

  it('rejects a malformed store code', () => {
    const { filters, reset } = parse('store=NOPE')
    expect(filters.store).toEqual([])
    expect(reset[0]?.reason).toContain('Not a store code')
  })

  it('rejects a well-formed store code the dataset does not carry', () => {
    // The shape is right and the store does not exist. Accepting it would render an
    // empty page that looks like a store with no sales.
    const { filters, reset } = parse('store=GSA-999')
    expect(filters.store).toEqual([])
    expect(reset[0]?.reason).toContain('No such store in this dataset')
  })

  it('rejects a lead source the dataset does not carry', () => {
    const { filters, reset } = parse('source=LDS-999')
    expect(filters.source).toBeNull()
    expect(reset[0]?.reason).toContain('No such lead source')
  })

  it('rejects an employee reference that is not one', () => {
    const { filters, reset } = parse('employee=42')
    expect(filters.employee).toBeNull()
    expect(reset[0]?.reason).toContain('EMP-00000')
  })

  it('rejects a catalogue value carrying markup', () => {
    const { filters, reset } = parse('make=%3Cscript%3E')
    expect(filters.make).toBeNull()
    expect(reset[0]?.key).toBe('make')
  })

  it('truncates a hostile value so a notice cannot become a paragraph', () => {
    const { reset } = parse(`make=${'x'.repeat(500)}`)
    expect(reset[0]?.received.length).toBeLessThanOrEqual(41)
    expect(reset[0]?.received.endsWith('…')).toBe(true)
  })

  it('reports every rejection rather than stopping at the first', () => {
    const { reset } = parse('compare=sideways&store=NOPE&employee=42')
    expect(reset.map((entry) => entry.key).sort()).toEqual([
      'compare',
      'employee',
      'store',
    ])
  })

  it('keeps the valid parameters when an invalid one is present', () => {
    const { filters, reset } = parse('period=2025-09&compare=sideways')
    expect(filters.period).toEqual({ kind: 'month', month: '2025-09' })
    expect(filters.compare).toBe('prior-period')
    expect(reset).toHaveLength(1)
  })
})

describe('unknown keys are ignored, and ignoring is not a rejection', () => {
  it('records them without raising the reset notice', () => {
    const { filters, reset, ignored } = parse(
      'foo=bar&utm_source=linkedin&period=2025-10'
    )
    expect(filters.period).toEqual({ kind: 'month', month: '2025-10' })
    expect(reset).toEqual([])
    expect([...ignored].sort()).toEqual(['foo', 'utm_source'])
  })

  it('does not carry them into the canonical URL', () => {
    const { filters } = parse('foo=bar&period=2025-10')
    expect(serializeFilters(filters)).toBe('period=2025-10')
  })

  it('takes the first value when a parameter is repeated', () => {
    // Merging them would make the URL mean something it does not say.
    const { filters } = parse('compare=none&compare=prior-year')
    expect(filters.compare).toBe('none')
  })
})

/* -------------------------------------------------------------------------- */
/* Reset and per-chip removal                                                  */
/* -------------------------------------------------------------------------- */

describe('reset and removal', () => {
  it('returns a single parameter to its default and leaves the rest', () => {
    const { filters } = parse('period=2025-09&store=GSA-001&condition=New')
    const withoutStore = withoutFilter(filters, 'store')
    expect(withoutStore.store).toEqual([])
    expect(withoutStore.period).toEqual({ kind: 'month', month: '2025-09' })
    expect(withoutStore.condition).toBe('New')
    expect(serializeFilters(withoutStore)).toBe('period=2025-09&condition=New')
  })

  it('returns each parameter type to its own default', () => {
    const { filters } = parse(
      'period=2025-09&compare=none&store=GSA-001&scope=new&condition=New&make=Ford'
    )
    expect(withoutFilter(filters, 'period').period).toEqual(DEFAULT_FILTERS.period)
    expect(withoutFilter(filters, 'compare').compare).toBe(DEFAULT_FILTERS.compare)
    expect(withoutFilter(filters, 'scope').scope).toBe(DEFAULT_FILTERS.scope)
    expect(withoutFilter(filters, 'condition').condition).toBeNull()
    expect(withoutFilter(filters, 'make').make).toBeNull()
  })

  it('empties completely when every parameter is removed in turn', () => {
    let filters: DashboardFilters = parse(
      'period=2025-09&compare=none&store=GSA-001&scope=new&dept=A&employee=EMP-00001' +
        '&source=LDS-001&campaign=C&make=M&model=X&condition=New&structure=cash&product=p'
    ).filters
    for (const key of FILTER_KEYS) filters = withoutFilter(filters, key)
    expect(isDefaultFilters(filters)).toBe(true)
    expect(filters).toEqual(DEFAULT_FILTERS)
  })
})

/* -------------------------------------------------------------------------- */
/* Route support                                                               */
/* -------------------------------------------------------------------------- */

describe('unsupported-on-this-route semantics', () => {
  it('declares a support level for every parameter in the grammar', () => {
    for (const key of FILTER_KEYS) {
      expect(EXECUTIVE_OVERVIEW_SUPPORT[key], key).toBeDefined()
      expect(EXECUTIVE_OVERVIEW_SUPPORT[key].label.length).toBeGreaterThan(0)
    }
  })

  it('applies period, comparison and store, and says so', () => {
    expect(EXECUTIVE_OVERVIEW_SUPPORT.period.support).toBe('applied')
    expect(EXECUTIVE_OVERVIEW_SUPPORT.compare.support).toBe('applied')
    expect(EXECUTIVE_OVERVIEW_SUPPORT.store.support).toBe('applied')
  })

  it('marks condition and lead source as partial, naming what they scope', () => {
    expect(EXECUTIVE_OVERVIEW_SUPPORT.condition.support).toBe('partial')
    expect(EXECUTIVE_OVERVIEW_SUPPORT.condition.note).toContain('inventory')
    expect(EXECUTIVE_OVERVIEW_SUPPORT.source.support).toBe('partial')
    expect(EXECUTIVE_OVERVIEW_SUPPORT.source.note).toContain('funnel')
  })

  it('marks the future-domain parameters not applicable, with a reason each', () => {
    for (const key of [
      'scope',
      'dept',
      'employee',
      'campaign',
      'make',
      'model',
      'structure',
      'product',
    ] as const) {
      const entry = EXECUTIVE_OVERVIEW_SUPPORT[key]
      expect(entry.support, key).toBe('not-applicable')
      expect(entry.note, key).toBeDefined()
      expect((entry.note ?? '').length, key).toBeGreaterThan(20)
    }
  })

  it('names the increment for a domain that does not exist yet', () => {
    expect(EXECUTIVE_OVERVIEW_SUPPORT.structure.note).toContain('DASH.6')
    expect(EXECUTIVE_OVERVIEW_SUPPORT.product.note).toContain('DASH.6')
  })
})

describe('the active-filter summary', () => {
  it('lists every non-default parameter in canonical order', () => {
    const { filters } = parse('condition=New&store=GSA-001&period=2025-09')
    const chips = activeFilterChips(filters, EXECUTIVE_OVERVIEW_SUPPORT)
    expect(chips.map((chip) => chip.key)).toEqual(['period', 'store', 'condition'])
  })

  it('includes filters this route cannot apply, marked as such', () => {
    // A filter that is in the URL and not in the summary is a filter the reader
    // believes is working.
    const { filters } = parse('structure=lease')
    const chips = activeFilterChips(filters, EXECUTIVE_OVERVIEW_SUPPORT)
    expect(chips).toHaveLength(1)
    expect(chips[0]?.support).toBe('not-applicable')
    expect(chips[0]?.note).toContain('DASH.6')
  })

  it('is empty for the default state', () => {
    expect(activeFilterChips(DEFAULT_FILTERS, EXECUTIVE_OVERVIEW_SUPPORT)).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The URL is the only persistence layer                                       */
/* -------------------------------------------------------------------------- */

describe('nothing persists outside the URL', () => {
  /**
   * Comments are stripped before the scan.
   *
   * These modules name the storage APIs they refuse to use, in prose, because the
   * refusal is the design decision worth recording. A guard that fires on its own
   * documentation is a guard somebody deletes — the same reasoning
   * `dashboard-boundaries.test.ts` records for its schema-name scan.
   */
  const sources = [
    'src/lib/dashboard/filters.ts',
    'src/components/dashboard/filter-bar.tsx',
    'src/components/dashboard/context-rail.tsx',
  ].map((path) => ({
    path,
    text: readFileSync(join(PORTFOLIO, path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, ''),
  }))

  it('touches no browser storage, cookie or session API', () => {
    for (const source of sources) {
      for (const forbidden of [
        'localStorage',
        'sessionStorage',
        'document.cookie',
        'indexedDB',
      ]) {
        expect(source.text.includes(forbidden), `${source.path} uses ${forbidden}`).toBe(
          false
        )
      }
    }
  })

  it('pushes rather than replaces, so back and forward have entries to visit', () => {
    const bar = sources.find((source) => source.path.endsWith('filter-bar.tsx'))
    expect(bar?.text).toContain('router.push')
    expect(bar?.text.includes('router.replace')).toBe(false)
  })

  it('submits a real GET form, so the controls work without JavaScript', () => {
    const bar = sources.find((source) => source.path.endsWith('filter-bar.tsx'))
    expect(bar?.text).toContain('method="get"')
    expect(bar?.text).toContain('type="submit"')
  })
})
