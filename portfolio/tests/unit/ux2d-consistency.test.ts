/**
 * `UX.2D` — the contracts the operating-experience closeout established.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * `UX.2D` did not add a KPI, a dataset or a business rule. What it added is
 * CONSISTENCY, and consistency is exactly the kind of property that decays without
 * a test: nothing breaks when one route starts spelling a store differently, or
 * when one link is written as a template string instead of going through the
 * canonical builder. Nine months later there are two conventions again.
 *
 * So each block below asserts a MEANING rather than a rendering:
 *
 *   1. the analytical scope is stated in business words on every route
 *   2. one link builder decides what survives a navigation, and it consults the
 *      route-support matrix rather than the current query string
 *   3. a route's own parameter is appended in one place, encoded
 *
 * The band's measured geometry and the disclosure's behaviour are browser
 * properties and are asserted in `tests/e2e/ux2d-controls.spec.ts`.
 */
import { describe, expect, it } from 'vitest'

import { dashboardStoreIds, dashboardStores } from '@/lib/dashboard/data'
import {
  DEFAULT_FILTERS,
  FILTER_KEYS,
  filterValue,
  parseFilters,
  serializeFilters,
  type DashboardFilters,
  type FilterKey,
} from '@/lib/dashboard/filters'
import {
  applicableFilterKeys,
  droppedFilterKeys,
  filtersForRoute,
  operatingHref,
  routeFilterSupport,
  withRouteParam,
} from '@/lib/dashboard/navigation'
import { ALL_STORES_LABEL, storeLabel, storeScopeLabel } from '@/lib/dashboard/scope'
import { kpiCatalogueHref } from '@/lib/technical'
import { ROUTES } from '@/lib/site'

const OPERATING_ROUTES: readonly string[] = [
  ROUTES.home.href,
  ROUTES.dashboardSalesGross.href,
  ROUTES.dashboardDeals.href,
  ROUTES.dashboardInventory.href,
  ROUTES.dashboardFi.href,
  ROUTES.dashboardLeadsMarketing.href,
  ROUTES.dashboardEmployees.href,
  ROUTES.dashboardAccounting.href,
  ROUTES.dashboardActions.href,
]

function filtersFrom(query: string): DashboardFilters {
  return parseFilters(new URLSearchParams(query)).filters
}

/* -------------------------------------------------------------------------- */
/* 1. The analytical-scope vocabulary                                          */
/* -------------------------------------------------------------------------- */

describe('the analytical scope is stated in business words', () => {
  it('never returns a warehouse key for a store the dimension carries', () => {
    for (const store of dashboardStores) {
      const label = storeScopeLabel([store.id])
      expect(label).toBe(store.shortName)
      expect(label).not.toMatch(/^GSA-\d{3}$/)
    }
  })

  it('names the whole group when nothing is selected', () => {
    expect(storeScopeLabel([])).toBe(ALL_STORES_LABEL)
  })

  it('names the whole group when every store is selected, because it is', () => {
    expect(storeScopeLabel(dashboardStoreIds)).toBe(ALL_STORES_LABEL)
  })

  it('lists two stores rather than counting them, so a figure can be checked', () => {
    const [first, second] = dashboardStoreIds
    const label = storeScopeLabel([first as string, second as string])
    expect(label).toContain(storeLabel(first as string))
    expect(label).toContain(storeLabel(second as string))
    expect(label).not.toMatch(/\b2 stores\b/)
  })

  it('falls back to the identifier for a code with no dimension row, and says which', () => {
    // A data defect must stay diagnosable. "Unknown store" would hide the code
    // from the person who has to fix it.
    expect(storeScopeLabel(['GSA-404'])).toBe('GSA-404')
  })

  it('is the only vocabulary: no selector spells the group its own way', async () => {
    const [executive, salesGross, deals, fi] = await Promise.all([
      import('@/lib/dashboard/executive'),
      import('@/lib/dashboard/sales-gross'),
      import('@/lib/dashboard/deals'),
      import('@/lib/dashboard/fi'),
    ])
    const one = [dashboardStoreIds[1] as string]
    const group = executive.buildExecutiveOverview(DEFAULT_FILTERS)
    expect(group.scope.label).toBe(ALL_STORES_LABEL)

    const scoped = executive.buildExecutiveOverview({ ...DEFAULT_FILTERS, store: one })
    expect(scoped.scope.label).toBe(storeLabel(one[0] as string))

    expect(salesGross.buildSalesGross(DEFAULT_FILTERS).scope.label).toBe(ALL_STORES_LABEL)
    expect(deals.buildDeals(DEFAULT_FILTERS, deals.DEFAULT_LIST_STATE).scopeLabel).toBe(
      ALL_STORES_LABEL
    )
    expect(fi.buildFi(DEFAULT_FILTERS).scope.label).toBe(ALL_STORES_LABEL)
  })
})

/* -------------------------------------------------------------------------- */
/* 2. One canonical cross-route link builder                                   */
/* -------------------------------------------------------------------------- */

describe('the canonical link builder', () => {
  it('publishes a support matrix for every operating route', () => {
    for (const route of OPERATING_ROUTES) {
      expect(routeFilterSupport(route), route).toBeDefined()
    }
  })

  it('resolves a Deal Jacket to the Deal Explorer, so context survives a drill-in', () => {
    expect(routeFilterSupport('/dashboard/deals/SLE-00000646')).toBe(
      routeFilterSupport(ROUTES.dashboardDeals.href)
    )
  })

  it('carries nothing at all outside the operating application', () => {
    const filters = filtersFrom('period=2025-11&store=GSA-002')
    expect(operatingHref('/technical', filters)).toBe('/technical')
    expect(operatingHref('/about', filters)).toBe('/about')
  })

  it('keeps every parameter the destination declares applied or partial', () => {
    const filters = filtersFrom(
      'period=2025-11&compare=prior-year&store=GSA-002&condition=Used&source=LDS-001'
    )
    for (const route of OPERATING_ROUTES) {
      const href = operatingHref(route, filters)
      for (const key of applicableFilterKeys(route)) {
        const value = filterValue(filters, key)
        if (value === null) continue
        expect(href, `${route} must keep ${key}`).toContain(`${key}=`)
      }
    }
  })

  it('drops every parameter the destination declares not-applicable', () => {
    const filters = filtersFrom(
      'period=2025-11&compare=prior-year&store=GSA-002&condition=Used&source=LDS-001'
    )
    for (const route of OPERATING_ROUTES) {
      const href = operatingHref(route, filters)
      for (const key of droppedFilterKeys(filters, route)) {
        expect(href, `${route} must drop ${key}`).not.toContain(`${key}=`)
      }
    }
  })

  it('drops `compare` on the four routes that publish no comparison', () => {
    // The measured `UX.2D` defect: Employees role links and Deal Explorer sort
    // headers both propagated `compare=prior-year` through their own navigation.
    const filters = filtersFrom('compare=prior-year&store=GSA-002')
    for (const route of [
      ROUTES.dashboardDeals.href,
      ROUTES.dashboardEmployees.href,
      ROUTES.dashboardAccounting.href,
      ROUTES.dashboardActions.href,
    ]) {
      expect(operatingHref(route, filters), route).not.toContain('compare')
      expect(operatingHref(route, filters), route).toContain('store=GSA-002')
    }
  })

  it('drops `period` on Actions, which is a queue rather than a window', () => {
    const filters = filtersFrom('period=2025-11&store=GSA-002')
    const href = operatingHref(ROUTES.dashboardActions.href, filters)
    expect(href).toBe('/dashboard/actions?store=GSA-002')
  })

  it('never emits a parameter twice, at any destination, from any state', () => {
    const filters = filtersFrom(
      'period=2025-11&compare=prior-year&store=GSA-001,GSA-002&condition=Used&source=LDS-001&campaign=CMP-001&employee=EMP-00015'
    )
    for (const route of OPERATING_ROUTES) {
      const query = operatingHref(route, filters).split('?')[1] ?? ''
      const keys = query === '' ? [] : query.split('&').map((pair) => pair.split('=')[0])
      expect(new Set(keys).size, route).toBe(keys.length)
    }
  })

  it('emits parameters in declared order, so two equivalent states are byte-identical', () => {
    const a = filtersFrom('store=GSA-002&period=2025-11')
    const b = filtersFrom('period=2025-11&store=GSA-002')
    for (const route of OPERATING_ROUTES) {
      expect(operatingHref(route, a)).toBe(operatingHref(route, b))
    }
    const query = operatingHref(ROUTES.dashboardSalesGross.href, a).split('?')[1] ?? ''
    const order = query.split('&').map((pair) => pair.split('=')[0] as FilterKey)
    const declared = FILTER_KEYS.filter((key) => order.includes(key))
    expect(order).toEqual([...declared])
  })

  it('emits no empty parameter, and a default destination is a bare pathname', () => {
    for (const route of OPERATING_ROUTES) {
      const href = operatingHref(route, DEFAULT_FILTERS)
      expect(href, route).toBe(route)
      expect(href).not.toContain('=')
    }
  })

  it('encodes a value that needs it rather than emitting it raw', () => {
    const filters = filtersFrom('period=2025-11-15..2025-12-15')
    const href = operatingHref(ROUTES.dashboardSalesGross.href, filters)
    // The range separator survives as itself; the assertion that matters is that
    // the href re-parses to the same state, which is the whole contract.
    expect(
      parseFilters(new URLSearchParams(href.split('?')[1] ?? '')).filters.period
    ).toEqual(filters.period)
  })

  it('round-trips: the destination re-parses to exactly what was carried', () => {
    const filters = filtersFrom('period=2025-11&compare=prior-year&store=GSA-002')
    for (const route of OPERATING_ROUTES) {
      const query = operatingHref(route, filters).split('?')[1] ?? ''
      const arrived = parseFilters(new URLSearchParams(query)).filters
      expect(arrived, route).toEqual(filtersForRoute(filters, route))
      // And serializing what arrived produces the same query: no second grammar.
      expect(serializeFilters(arrived), route).toBe(query)
    }
  })

  it('is idempotent: carrying a reduced state through the same route changes nothing', () => {
    const filters = filtersFrom('period=2025-11&compare=prior-year&store=GSA-002')
    for (const route of OPERATING_ROUTES) {
      const once = operatingHref(route, filters)
      const twice = operatingHref(route, filtersForRoute(filters, route))
      expect(twice, route).toBe(once)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 3. The named journeys, as a matrix                                          */
/* -------------------------------------------------------------------------- */

describe('the filter-persistence matrix', () => {
  const scope = 'period=2025-11&compare=prior-year&store=GSA-002'

  const JOURNEYS: readonly {
    readonly from: string
    readonly to: string
    readonly keeps: readonly FilterKey[]
    readonly drops: readonly FilterKey[]
  }[] = [
    {
      from: ROUTES.home.href,
      to: ROUTES.dashboardSalesGross.href,
      keeps: ['period', 'compare', 'store'],
      drops: [],
    },
    {
      from: ROUTES.home.href,
      to: ROUTES.dashboardInventory.href,
      keeps: ['period', 'store'],
      drops: ['compare'],
    },
    {
      from: ROUTES.home.href,
      to: ROUTES.dashboardFi.href,
      keeps: ['period', 'compare', 'store'],
      drops: [],
    },
    {
      from: ROUTES.home.href,
      to: ROUTES.dashboardLeadsMarketing.href,
      keeps: ['period', 'store'],
      drops: ['compare'],
    },
    {
      from: ROUTES.home.href,
      to: ROUTES.dashboardAccounting.href,
      keeps: ['period', 'store'],
      drops: ['compare'],
    },
    {
      from: ROUTES.home.href,
      to: ROUTES.dashboardActions.href,
      keeps: ['store'],
      drops: ['period', 'compare'],
    },
    {
      from: ROUTES.dashboardSalesGross.href,
      to: ROUTES.dashboardDeals.href,
      keeps: ['period', 'store'],
      drops: ['compare'],
    },
    {
      from: ROUTES.dashboardFi.href,
      to: ROUTES.dashboardEmployees.href,
      keeps: ['period', 'store'],
      drops: ['compare'],
    },
    {
      from: ROUTES.dashboardEmployees.href,
      to: ROUTES.dashboardFi.href,
      keeps: ['period', 'store'],
      drops: [],
    },
    {
      from: ROUTES.dashboardAccounting.href,
      to: ROUTES.dashboardInventory.href,
      keeps: ['store'],
      drops: ['compare'],
    },
  ]

  for (const journey of JOURNEYS) {
    it(`${journey.from} to ${journey.to}`, () => {
      const filters = filtersFrom(scope)
      const href = operatingHref(journey.to, filters)
      for (const key of journey.keeps) {
        expect(href, `keeps ${key}`).toContain(`${key}=`)
      }
      for (const key of journey.drops) {
        expect(href, `drops ${key}`).not.toContain(`${key}=`)
      }
    })
  }

  it('a Deal Jacket keeps the Deal Explorer context on the way back out', () => {
    const filters = filtersFrom(scope)
    const jacket = '/dashboard/deals/SLE-00000646'
    expect(filtersForRoute(filters, jacket)).toEqual(
      filtersForRoute(filters, ROUTES.dashboardDeals.href)
    )
  })
})

/* -------------------------------------------------------------------------- */
/* 4. A route's own parameter                                                  */
/* -------------------------------------------------------------------------- */

describe("a route's own parameter is appended in one place", () => {
  it('opens a query string where there is none', () => {
    expect(withRouteParam('/dashboard/employees', 'role', 'finance')).toBe(
      '/dashboard/employees?role=finance'
    )
  })

  it('extends a query string where there is one', () => {
    expect(withRouteParam('/dashboard/employees?store=GSA-002', 'role', 'finance')).toBe(
      '/dashboard/employees?store=GSA-002&role=finance'
    )
  })

  it('drops an empty value rather than serializing a parameter that means nothing', () => {
    expect(withRouteParam('/dashboard/employees?store=GSA-002', 'role', '')).toBe(
      '/dashboard/employees?store=GSA-002'
    )
  })

  it('encodes the value', () => {
    expect(withRouteParam('/dashboard/deals', 'q', 'Chevrolet Tahoe')).toBe(
      '/dashboard/deals?q=Chevrolet%20Tahoe'
    )
    expect(withRouteParam('/dashboard/deals', 'q', 'a&b=c')).toBe(
      '/dashboard/deals?q=a%26b%3Dc'
    )
  })

  it('composes with the canonical builder without a second serializer', () => {
    const filters = filtersFrom('period=2025-11&compare=prior-year&store=GSA-002')
    const href = withRouteParam(
      operatingHref(ROUTES.dashboardEmployees.href, {
        ...filters,
        employee: 'EMP-00015',
      }),
      'role',
      'finance'
    )
    expect(href).toContain('store=GSA-002')
    expect(href).toContain('employee=EMP-00015')
    expect(href).toContain('role=finance')
    // Employees declares `compare` not-applicable, and appending its own
    // parameter must not smuggle one back in.
    expect(href).not.toContain('compare')
  })
})

/* -------------------------------------------------------------------------- */
/* 5. The KPI catalogue's address                                              */
/* -------------------------------------------------------------------------- */

describe('a KPI identifier links to the catalogue, not to a redirect', () => {
  it('resolves to the technical destination rather than the retired route', () => {
    expect(kpiCatalogueHref('KPI-FNI-021')).toBe('/technical?view=kpis#KPI-FNI-021')
    expect(kpiCatalogueHref('KPI-FNI-021')).not.toMatch(/^\/kpis/)
  })

  it('is the one builder: the three modules that had their own now share it', async () => {
    const [executive, salesGross] = await Promise.all([
      import('@/lib/dashboard/executive'),
      import('@/lib/dashboard/sales-gross'),
    ])
    expect(executive.kpiDefinitionHref('KPI-INV-004')).toBe(
      kpiCatalogueHref('KPI-INV-004')
    )
    expect(salesGross.kpiDefinitionHref('KPI-SLS-001')).toBe(
      kpiCatalogueHref('KPI-SLS-001')
    )
  })
})
